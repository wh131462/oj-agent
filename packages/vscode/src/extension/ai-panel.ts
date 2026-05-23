import * as vscode from 'vscode';
import type { AIServices } from './services.js';
import { isRedactEnabled } from './services.js';
import { buildContext, RateLimitError, type AIContextInput } from '@oj-agent/core';
import {
  renderMarkdown,
  getMarkdownAssetUris,
  buildMarkdownAssetLinks,
  getMarkdownStyleBlock,
} from './webview-content/markdown.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type WebviewMsgIn =
  | { kind: 'send'; text: string }
  | { kind: 'stop' }
  | { kind: 'clear' }
  | { kind: 'openSettings' };

type WebviewMsgOut =
  | { kind: 'init'; profile: string | null; redact: boolean; topic?: string; history: Array<{ role: 'user' | 'assistant'; html: string }>; initialPrompt?: string }
  | { kind: 'userMsg'; html: string }
  | { kind: 'assistantStart' }
  | { kind: 'assistantHtml'; html: string }
  | { kind: 'assistantDone'; html: string }
  | { kind: 'cleared' }
  | { kind: 'error'; message: string; httpStatus?: number; rateLimit?: number }
  | { kind: 'state'; profile: string | null; redact: boolean };

/** 流式渲染节流间隔（ms）—— 防止每个 chunk 都重新跑一次 markdown-it */
const STREAM_RENDER_INTERVAL_MS = 80;

export class AIPanel {
  private static current?: AIPanel;
  private panel: vscode.WebviewPanel;
  private abortCtl: AbortController | null = null;
  private disposables: vscode.Disposable[] = [];

  /** 对话历史（不含 system prompt） */
  private history: ChatMessage[] = [];
  /** 当前会话的系统提示词（从首次 prepare 时构造，后续追问保持一致） */
  private systemPrompt = '';
  /** 当前话题（题目标题），用于面板 title */
  private topic = '';
  /** 当前正在累积的 assistant 消息（流式拼接） */
  private streaming = '';
  /** 节流计时器：防止每个 chunk 都跑 markdown-it */
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(private readonly ctx: vscode.ExtensionContext, private readonly services: AIServices) {
    this.panel = vscode.window.createWebviewPanel(
      'ojAgent.aiPanel',
      'OJ-Agent · AI 助手',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'resources')],
      },
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m: WebviewMsgIn) => this.onMessage(m), null, this.disposables);
  }

  static showWith(ctx: vscode.ExtensionContext, services: AIServices, input: AIContextInput): AIPanel | undefined {
    return AIPanel.open(ctx, services, input);
  }

  static open(
    ctx: vscode.ExtensionContext,
    services: AIServices,
    input?: AIContextInput,
  ): AIPanel | undefined {
    const active = services.profiles.getActive();
    if (!active) {
      void vscode.window
        .showWarningMessage('请先在设置中添加 AI 模型 Profile', '打开设置')
        .then((pick) => {
          if (pick === '打开设置') void vscode.commands.executeCommand('ojAgent.ai.openSettings');
        });
      return undefined;
    }
    if (!AIPanel.current) {
      AIPanel.current = new AIPanel(ctx, services);
    } else {
      AIPanel.current.panel.reveal(vscode.ViewColumn.Beside);
    }
    if (input) {
      void AIPanel.current.prepare(input);
    } else {
      void AIPanel.current.prepareEmpty();
    }
    return AIPanel.current;
  }

  static refreshState(services: AIServices): void {
    if (!AIPanel.current) return;
    const active = services.profiles.getActive();
    AIPanel.current.postOut({
      kind: 'state',
      profile: active?.label ?? null,
      redact: isRedactEnabled(),
    });
  }

  /** 从题面工具栏触发：根据 action 构造首条 user 消息，并立即开始流式回答 */
  private async prepare(input: AIContextInput): Promise<void> {
    const { system, user } = buildContext(input);
    const topic = input.problem?.title ?? '';
    this.topic = topic;
    if (topic) this.panel.title = `AI · ${topic}`;

    // 新会话：重置历史与系统提示词
    this.systemPrompt = system;
    this.history = [];
    this.streaming = '';

    const active = this.services.profiles.getActive();
    this.postOut({
      kind: 'init',
      profile: active?.label ?? null,
      redact: isRedactEnabled(),
      topic,
      history: [],
      initialPrompt: user,
    });

    // 自动发送首条问题
    await this.sendUser(user);
  }

  /** 通过命令面板打开：空状态对话 */
  private async prepareEmpty(): Promise<void> {
    const active = this.services.profiles.getActive();
    if (!this.systemPrompt) {
      this.systemPrompt = '你是一名资深算法竞赛教练。回答简洁、分点、用中文。代码块使用对应语言的高亮 fenced block。支持用户多轮追问，结合上下文给出准确解答。';
    }
    const renderedHistory = await Promise.all(
      this.history.map(async (h) => ({ role: h.role, html: await renderMarkdown(h.content) })),
    );
    this.postOut({
      kind: 'init',
      profile: active?.label ?? null,
      redact: isRedactEnabled(),
      topic: this.topic,
      history: renderedHistory,
    });
  }

  private async onMessage(m: WebviewMsgIn): Promise<void> {
    if (m.kind === 'stop') {
      this.abortCtl?.abort();
      return;
    }
    if (m.kind === 'openSettings') {
      void vscode.commands.executeCommand('ojAgent.ai.openSettings');
      return;
    }
    if (m.kind === 'clear') {
      const confirm = await vscode.window.showWarningMessage(
        '确认清空当前对话？',
        { modal: true },
        '清空',
      );
      if (confirm !== '清空') return;
      this.history = [];
      this.streaming = '';
      this.abortCtl?.abort();
      this.postOut({ kind: 'cleared' });
      return;
    }
    if (m.kind === 'send') {
      await this.sendUser(m.text);
    }
  }

  private async sendUser(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.history.push({ role: 'user', content: trimmed });
    const html = await renderMarkdown(trimmed);
    this.postOut({ kind: 'userMsg', html });
    await this.runStream();
  }

  /** 将历史拼接为 user prompt 传给 runner（runner 当前只接收 system + user 字符串） */
  private composeUserPrompt(): string {
    // 第一条用户消息已通过 system+initial user 启动；之后的多轮拼接为简单的对话格式
    if (this.history.length === 1) {
      return this.history[0]!.content;
    }
    const lines: string[] = [];
    for (const m of this.history) {
      if (m.role === 'user') lines.push(`用户：${m.content}`);
      else lines.push(`助手：${m.content}`);
    }
    lines.push('助手：');
    return lines.join('\n\n');
  }

  private async runStream(): Promise<void> {
    const profile = this.services.profiles.getActive();
    if (!profile) {
      this.postOut({ kind: 'error', message: '当前无可用 Profile' });
      return;
    }
    const apiKey = await this.services.vault.get(profile.id);
    if (!apiKey) {
      this.postOut({ kind: 'error', message: `Profile "${profile.label}" 未配置 API Key` });
      return;
    }

    this.abortCtl?.abort();
    this.abortCtl = new AbortController();
    this.streaming = '';
    this.postOut({ kind: 'assistantStart' });

    try {
      for await (const chunk of this.services.runner.run({
        profile,
        apiKey,
        system: this.systemPrompt,
        user: this.composeUserPrompt(),
        signal: this.abortCtl.signal,
        redactEnabled: isRedactEnabled(),
      })) {
        if (chunk.type === 'text' && chunk.text) {
          this.streaming += chunk.text;
          this.scheduleStreamRender();
        } else if (chunk.type === 'done') {
          await this.commitAssistant();
          return;
        } else if (chunk.type === 'error') {
          this.cancelStreamRender();
          this.postOut({
            kind: 'error',
            message: chunk.error?.message ?? 'unknown error',
            httpStatus: chunk.error?.httpStatus,
          });
          return;
        }
      }
      await this.commitAssistant();
    } catch (e) {
      this.cancelStreamRender();
      if (e instanceof RateLimitError) {
        this.postOut({ kind: 'error', message: e.message, rateLimit: e.retryAfterSeconds });
      } else {
        this.postOut({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      this.abortCtl = null;
    }
  }

  /** 节流地把当前累积的 streaming markdown 渲染并推到 webview。 */
  private scheduleStreamRender(): void {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      void this.flushStreamRender();
    }, STREAM_RENDER_INTERVAL_MS);
  }

  private async flushStreamRender(): Promise<void> {
    const snapshot = this.streaming;
    if (!snapshot) return;
    const html = await renderMarkdown(snapshot);
    this.postOut({ kind: 'assistantHtml', html });
  }

  private cancelStreamRender(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
  }

  private async commitAssistant(): Promise<void> {
    this.cancelStreamRender();
    const final = this.streaming;
    if (final) {
      this.history.push({ role: 'assistant', content: final });
    }
    this.streaming = '';
    const html = final ? await renderMarkdown(final) : '';
    this.postOut({ kind: 'assistantDone', html });
  }

  private postOut(msg: WebviewMsgOut): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    this.abortCtl?.abort();
    this.abortCtl = null;
    this.cancelStreamRender();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    AIPanel.current = undefined;
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2);
    const assetUris = getMarkdownAssetUris(this.panel.webview, this.ctx.extensionUri);
    const cspSource = this.panel.webview.cspSource;
    const csp = [
      `default-src 'none'`,
      `img-src ${cspSource} https: data:`,
      `font-src ${cspSource}`,
      `style-src ${cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
${buildMarkdownAssetLinks(assetUris)}
<style nonce="${nonce}">
${getMarkdownStyleBlock()}
  :root {
    --oj-primary: #3b9eff;
    --oj-primary-hover: #60b4ff;
    --oj-primary-dim: rgba(59, 158, 255, 0.12);
    --oj-primary-border: rgba(59, 158, 255, 0.3);
    --oj-user-bg: rgba(59, 158, 255, 0.10);
    --oj-user-border: rgba(59, 158, 255, 0.25);
    --oj-assistant-bg: var(--vscode-editorWidget-background);
    --oj-border: rgba(127, 127, 127, 0.18);
    --oj-radius: 8px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
    font-size: 13px;
    line-height: 1.6;
  }

  /* ── Header ── */
  .chat-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--oj-border);
    flex-shrink: 0;
    background: var(--oj-assistant-bg);
  }
  .chat-header h1 {
    font-size: 13px;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-header .badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--oj-primary-dim);
    color: var(--oj-primary);
    border: 1px solid var(--oj-primary-border);
    white-space: nowrap;
  }
  .chat-header .icon-btn {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 0;
    cursor: pointer;
    border-radius: 4px;
  }
  .chat-header .icon-btn:hover { background: rgba(127,127,127,0.12); color: var(--vscode-foreground); }

  /* ── Messages ── */
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .msg { display: flex; gap: 10px; max-width: 100%; }
  .msg .avatar {
    width: 26px; height: 26px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
  }
  .msg.user .avatar { background: var(--oj-user-bg); color: var(--oj-primary); border: 1px solid var(--oj-user-border); }
  .msg.assistant .avatar { background: var(--oj-assistant-bg); color: var(--vscode-descriptionForeground); border: 1px solid var(--oj-border); }
  .msg .bubble {
    flex: 1;
    min-width: 0;
    padding: 10px 14px;
    border-radius: var(--oj-radius);
    border: 1px solid;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .msg.user .bubble { background: var(--oj-user-bg); border-color: var(--oj-user-border); }
  .msg.assistant .bubble { background: var(--oj-assistant-bg); border-color: var(--oj-border); }
  /* 让 bubble 内的 markdown 段落首尾不要再多一段空白 */
  .bubble.markdown-body > :first-child { margin-top: 0; }
  .bubble.markdown-body > :last-child { margin-bottom: 0; }

  /* loading dots */
  .typing { display: inline-flex; gap: 3px; padding: 4px 0; }
  .typing span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--oj-primary);
    animation: typing 1.2s infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.2s; }
  .typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }

  /* empty state */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 20px;
    opacity: 0.6;
  }
  .empty-state .icon { font-size: 32px; margin-bottom: 12px; }
  .empty-state h2 { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .empty-state p { font-size: 12px; color: var(--vscode-descriptionForeground); }

  /* error banner */
  #error {
    margin: 0 14px 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: #f87171;
    font-size: 12px;
    display: none;
  }

  /* ── Composer ── */
  .composer {
    padding: 10px 14px 14px;
    border-top: 1px solid var(--oj-border);
    flex-shrink: 0;
    background: var(--vscode-editor-background);
  }
  .composer-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    background: var(--vscode-input-background);
    border: 1px solid var(--oj-border);
    border-radius: var(--oj-radius);
    padding: 6px 8px 6px 12px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .composer-row:focus-within { border-color: var(--oj-primary-border); box-shadow: 0 0 0 2px var(--oj-primary-dim); }
  #input {
    flex: 1;
    background: transparent;
    color: var(--vscode-input-foreground);
    border: 0;
    outline: none;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    padding: 6px 0;
    max-height: 200px;
    min-height: 22px;
  }
  .send-btn {
    flex-shrink: 0;
    background: var(--oj-primary);
    color: #fff;
    border: 0;
    border-radius: 5px;
    width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
  }
  .send-btn:hover:not(:disabled) { background: var(--oj-primary-hover); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .send-btn.stop { background: rgba(248, 113, 113, 0.8); }
  .send-btn.stop:hover:not(:disabled) { background: #f87171; }
  .send-btn svg { width: 14px; height: 14px; }
  .composer-hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 6px;
    opacity: 0.6;
    display: flex;
    justify-content: space-between;
  }
</style></head><body>
<div class="chat-header">
  <h1 id="title">AI 助手</h1>
  <span class="badge" id="profileBadge">--</span>
  <button class="icon-btn" id="clearBtn" title="清空对话">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 4h10M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M6 7v5M10 7v5M4 4v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4"/>
    </svg>
  </button>
  <button class="icon-btn" id="settingsBtn" title="AI 设置">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="8" cy="8" r="2"/>
      <path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.95 3.05l-1.41 1.41M4.46 11.54l-1.41 1.41M12.95 12.95l-1.41-1.41M4.46 4.46L3.05 3.05"/>
    </svg>
  </button>
</div>

<div id="messages">
  <div class="empty-state" id="empty">
    <div class="icon">💬</div>
    <h2>开始与 AI 助手对话</h2>
    <p>从题面工具栏选择 AI 操作，或在下方输入问题</p>
  </div>
</div>

<div id="error"></div>

<div class="composer">
  <div class="composer-row">
    <textarea id="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
    <button class="send-btn" id="sendBtn" title="发送" disabled>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M2 8h12M9 3l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  <div class="composer-hint">
    <span id="hintLeft">Enter 发送 · Shift+Enter 换行</span>
    <span id="hintRight"></span>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let isStreaming = false;
  let currentAssistantBubble = null;
  let userScrolled = false;

  function clearEmpty() {
    const e = $('empty');
    if (e) e.remove();
  }

  function appendMsgHtml(role, html) {
    clearEmpty();
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '我' : 'AI';
    const bubble = document.createElement('div');
    bubble.className = 'bubble markdown-body';
    bubble.innerHTML = html;
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    $('messages').appendChild(wrap);
    scrollBottom();
    return bubble;
  }

  function startAssistantBubble() {
    clearEmpty();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = 'AI';
    const bubble = document.createElement('div');
    bubble.className = 'bubble markdown-body';
    bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    $('messages').appendChild(wrap);
    currentAssistantBubble = bubble;
    userScrolled = false;
    scrollBottom();
  }

  function updateAssistantBubble(html) {
    if (currentAssistantBubble) {
      currentAssistantBubble.innerHTML = html;
      if (!userScrolled) scrollBottom();
    }
  }

  function finalizeAssistant(html) {
    if (currentAssistantBubble) {
      if (html && html.trim()) {
        currentAssistantBubble.innerHTML = html;
      } else if (!currentAssistantBubble.textContent.trim()) {
        currentAssistantBubble.innerHTML = '<p><em style="opacity:0.5">（无回复）</em></p>';
      }
    }
    currentAssistantBubble = null;
  }

  function scrollBottom() {
    const m = $('messages');
    m.scrollTop = m.scrollHeight;
  }

  // 用户主动上滚后，流式更新就别再抢滚动权
  $('messages').addEventListener('scroll', () => {
    const m = $('messages');
    const atBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 24;
    userScrolled = !atBottom;
  });

  function setStreaming(b) {
    isStreaming = b;
    const btn = $('sendBtn');
    if (b) {
      btn.classList.add('stop');
      btn.disabled = false;
      btn.title = '停止生成';
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>';
    } else {
      btn.classList.remove('stop');
      btn.disabled = !$('input').value.trim();
      btn.title = '发送';
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8h12M9 3l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  }

  function showError(msg) {
    $('error').textContent = msg;
    $('error').style.display = 'block';
  }
  function clearError() {
    $('error').style.display = 'none';
  }

  // ── Input handling ──
  const input = $('input');
  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }
  input.addEventListener('input', () => {
    autoResize();
    if (!isStreaming) $('sendBtn').disabled = !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  function submit() {
    if (isStreaming) {
      vscode.postMessage({ kind: 'stop' });
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    clearError();
    input.value = '';
    autoResize();
    $('sendBtn').disabled = true;
    vscode.postMessage({ kind: 'send', text });
  }

  $('sendBtn').onclick = submit;
  $('clearBtn').onclick = () => {
    vscode.postMessage({ kind: 'clear' });
  };
  $('settingsBtn').onclick = () => vscode.postMessage({ kind: 'openSettings' });

  function renderEmpty() {
    $('messages').innerHTML = '<div class="empty-state" id="empty"><div class="icon">💬</div><h2>开始与 AI 助手对话</h2><p>从题面工具栏选择 AI 操作，或在下方输入问题</p></div>';
  }

  // ── Receive ──
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.kind === 'init') {
      $('profileBadge').textContent = m.profile || '未配置';
      $('title').textContent = m.topic ? 'AI · ' + m.topic : 'AI 助手';
      $('messages').innerHTML = '';
      if (!m.history || m.history.length === 0) {
        renderEmpty();
      } else {
        for (const h of m.history) appendMsgHtml(h.role, h.html);
      }
    } else if (m.kind === 'state') {
      $('profileBadge').textContent = m.profile || '未配置';
    } else if (m.kind === 'userMsg') {
      appendMsgHtml('user', m.html);
    } else if (m.kind === 'assistantStart') {
      startAssistantBubble();
      setStreaming(true);
    } else if (m.kind === 'assistantHtml') {
      updateAssistantBubble(m.html);
    } else if (m.kind === 'assistantDone') {
      finalizeAssistant(m.html);
      setStreaming(false);
    } else if (m.kind === 'cleared') {
      renderEmpty();
      clearError();
      setStreaming(false);
    } else if (m.kind === 'error') {
      finalizeAssistant('');
      setStreaming(false);
      let txt = m.message;
      if (m.httpStatus === 401) txt = '鉴权失败 (HTTP 401)：请检查 API Key';
      else if (m.httpStatus) txt = 'HTTP ' + m.httpStatus + '：' + m.message;
      else if (m.rateLimit) txt = '速率限制：' + m.rateLimit + ' 秒后重试';
      showError(txt);
    }
  });
</script></body></html>`;
  }
}
