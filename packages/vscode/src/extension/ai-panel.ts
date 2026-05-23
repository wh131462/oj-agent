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
    if (topic) this.panel.title = `${topic}`;

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
    --fg: var(--vscode-foreground);
    --fg-muted: var(--vscode-descriptionForeground);
    --bg: var(--vscode-editor-background);
    --bg-soft: var(--vscode-editorWidget-background);
    --bg-input: var(--vscode-input-background);
    --bg-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.1));
    --border: var(--vscode-widget-border, rgba(127,127,127,0.18));
    --focus: var(--vscode-focusBorder);
    --error: var(--vscode-errorForeground);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--fg);
    background: var(--bg);
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
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
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
  .chat-header .profile {
    font-size: 11px;
    color: var(--fg-muted);
    white-space: nowrap;
    padding-right: 4px;
  }
  .chat-header .profile::before {
    content: '';
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #4ade80;
    margin-right: 6px;
    vertical-align: middle;
  }
  .chat-header .profile.off::before { background: var(--fg-muted); opacity: 0.5; }
  .icon-btn {
    width: 26px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent;
    color: var(--fg-muted);
    border: 0;
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--fg); }
  .icon-btn svg { width: 14px; height: 14px; }

  /* ── Messages ── */
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .msg { display: flex; flex-direction: column; gap: 4px; max-width: 100%; }
  .msg .role {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .msg .role svg { width: 12px; height: 12px; }
  .msg .bubble {
    padding: 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .msg.user .bubble {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .msg.assistant .bubble {
    padding: 2px 0;
  }
  .bubble.markdown-body > :first-child { margin-top: 0; }
  .bubble.markdown-body > :last-child { margin-bottom: 0; }

  /* loading dots */
  .typing { display: inline-flex; gap: 4px; padding: 6px 0; }
  .typing span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--fg-muted);
    animation: typing 1.2s infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

  /* empty state */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 20px;
    color: var(--fg-muted);
  }
  .empty-state svg { width: 32px; height: 32px; opacity: 0.5; margin-bottom: 14px; }
  .empty-state h2 { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--fg); }
  .empty-state p { font-size: 12px; }

  /* error banner */
  #error {
    margin: 0 14px 8px;
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--vscode-inputValidation-errorBackground, rgba(248,113,113,0.08));
    border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(248,113,113,0.4));
    color: var(--error);
    font-size: 12px;
    display: none;
  }

  /* ── Composer ── */
  .composer {
    padding: 8px 12px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .composer-row {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 4px 4px 10px;
    transition: border-color 0.15s;
  }
  .composer-row:focus-within { border-color: var(--focus); }
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
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 0;
    border-radius: 4px;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
  }
  .send-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .send-btn.stop {
    background: transparent;
    color: var(--error);
    border: 1px solid var(--error);
  }
  .send-btn.stop:hover:not(:disabled) { background: rgba(248,113,113,0.1); }
  .send-btn svg { width: 13px; height: 13px; }
  .composer-hint {
    font-size: 10px;
    color: var(--fg-muted);
    margin-top: 6px;
    opacity: 0.7;
    display: flex;
    justify-content: space-between;
  }
</style></head><body>
<div class="chat-header">
  <h1 id="title">AI 助手</h1>
  <span class="profile off" id="profileBadge">--</span>
  <button class="icon-btn" id="clearBtn" title="清空对话">
<svg t="1779559643121" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1753" width="200" height="200"><path d="M254.398526 804.702412l-0.030699-4.787026C254.367827 801.546535 254.380106 803.13573 254.398526 804.702412zM614.190939 259.036661c-22.116717 0-40.047088 17.910928-40.047088 40.047088l0.37146 502.160911c0 22.097274 17.930371 40.048111 40.047088 40.048111s40.048111-17.950837 40.048111-40.048111l-0.350994-502.160911C654.259516 276.948613 636.328122 259.036661 614.190939 259.036661zM893.234259 140.105968l-318.891887 0.148379-0.178055-41.407062c0-22.13616-17.933441-40.048111-40.067554-40.048111-7.294127 0-14.126742 1.958608-20.017916 5.364171-5.894244-3.405563-12.729929-5.364171-20.031219-5.364171-22.115694 0-40.047088 17.911952-40.047088 40.048111l0.188288 41.463344-230.115981 0.106424c-3.228531-0.839111-6.613628-1.287319-10.104125-1.287319-3.502777 0-6.89913 0.452301-10.136871 1.296529l-73.067132 0.033769c-22.115694 0-40.048111 17.950837-40.048111 40.047088 0 22.13616 17.931395 40.048111 40.048111 40.048111l43.176358-0.020466 0.292666 617.902982 0.059352 0 0 42.551118c0 44.233434 35.862789 80.095199 80.095199 80.095199l40.048111 0 0 0.302899 440.523085-0.25685 0-0.046049 40.048111 0c43.663452 0 79.146595-34.95 80.054267-78.395488l-0.329505-583.369468c0-22.135136-17.930371-40.047088-40.048111-40.047088-22.115694 0-40.047088 17.911952-40.047088 40.047088l0.287549 509.324054c-1.407046 60.314691-18.594497 71.367421-79.993892 71.367421l41.575908 1.022283-454.442096 0.26606 52.398394-1.288343c-62.715367 0-79.305207-11.522428-80.0645-75.308173l0.493234 76.611865-0.543376 0-0.313132-660.818397 236.82273-0.109494c1.173732 0.103354 2.360767 0.166799 3.561106 0.166799 1.215688 0 2.416026-0.063445 3.604084-0.169869l32.639375-0.01535c1.25355 0.118704 2.521426 0.185218 3.805676 0.185218 1.299599 0 2.582825-0.067538 3.851725-0.188288l354.913289-0.163729c22.115694 0 40.050158-17.911952 40.050158-40.047088C933.283394 158.01792 915.349953 140.105968 893.234259 140.105968zM774.928806 815.294654l0.036839 65.715701-0.459464 0L774.928806 815.294654zM413.953452 259.036661c-22.116717 0-40.048111 17.910928-40.048111 40.047088l0.37146 502.160911c0 22.097274 17.931395 40.048111 40.049135 40.048111 22.115694 0 40.047088-17.950837 40.047088-40.048111l-0.37146-502.160911C454.00054 276.948613 436.069145 259.036661 413.953452 259.036661z" fill="currentColor" p-id="1754"></path></svg>
  </button>
  <button class="icon-btn" id="settingsBtn" title="AI 设置">
    <svg viewBox="0 0 1024 1024" fill="currentColor">
      <path d="M509.4 666.1c-83.6 0-151.5-67.9-151.5-151.5s67.9-151.5 151.5-151.5 151.5 67.9 151.5 151.5-67.9 151.5-151.5 151.5z m0-261.2c-60.6 0-109.7 49.1-109.7 109.7s49.1 109.7 109.7 109.7 109.7-49.1 109.7-109.7-49.1-109.7-109.7-109.7z"/>
      <path d="M556.4 930h-83.6c-47.5 0-86.2-38.7-86.2-86.2v-23c0-1-0.5-2.1-1.6-2.6h-0.5c-1-0.5-2.1 0-3.1 0.5l-14.6 15.2c-16.2 16.2-37.1 25.1-59.6 25.1-22.5 0-43.4-8.9-59-24.6l-59-59c-32.4-32.4-32.4-85.2 0-118.1l15.7-15.2c1-1 1-2.1 0.5-3.1v-0.5c-0.5-1-1.6-1.6-2.6-1.6h-23c-47.5 0-86.2-38.7-86.2-86.2v-78.4c0.5-47 39.2-85.7 86.7-85.7h21.4c1 0 2.1-0.5 2.6-2.1 0.5-1 1-2.6 1.6-3.7 0.5-1 0-2.1-0.5-3.1l-16.2-16.7c-32.4-32.4-32.4-85.7 0-118l59-59c15.7-15.7 36.6-24.6 59-24.6 22.5 0 43.4 8.9 59 24.6l15.2 15.7c0.5 1 2.1 1 3.1 0.5h0.5c1-0.5 1.6-1.6 1.6-2.6v-17.8c0-47.5 38.7-86.2 86.2-86.2h83.6c44.4 0 81 36.6 81 81v21.4c0 1 0.5 2.1 2.1 2.6 1.6 0.5 2.6 1 3.7 1.6 1 0.5 2.1 0 3.1-0.5l16.7-16.2c32.4-32.4 85.2-32.4 118.1 0.5l59 59c15.7 15.7 24.6 36.6 24.6 59 0 22.5-8.9 43.4-24.6 59l-15.7 16.2c-0.5 0.5-1 2.1-0.5 2.6 0.5 1 1 2.6 1.6 3.7 0.5 1 1.6 2.1 2.6 2.1h21.4c44.4 0 81 36.6 81 81v88.8c0 44.4-36.6 81-81 81h-23c-1 0-2.1 0.5-2.6 1.6-0.5 1.6-0.5 2.6 0.5 3.7l15.2 14.6c16.2 16.2 25.1 37.1 24.6 59.6 0 22.5-8.9 43.4-24.6 59l-59 59c-15.7 15.7-36.6 24.6-59 24.6s-43.4-8.9-59-24.6l-16.2-15.7c-0.5-0.5-2.1-1-2.6-0.5-1 0.5-2.6 1-3.7 1.6-1 0.5-2.1 1.6-2.1 2.6V844c0 49.4-36.6 86-81 86zM402.3 780.5c16.2 7.3 26.1 23 26.1 40.8V844c0 24.6 19.9 44.4 44.4 44.4h83.6c21.4 0 39.2-17.8 39.2-39.2v-26.6c0-18.3 11-34.5 28.2-41.3 1-0.5 1.6-0.5 2.6-1 16.7-7.3 35.5-3.7 48.6 8.9l16.2 15.7c16.7 16.7 43.4 16.7 59.6 0l59-59c7.8-7.8 12-18.3 12-29.8 0-11-4.2-21.4-12-29.8l-14.6-14.1c-13.6-13.1-17.8-32.9-9.9-50.2v-0.5c6.8-15.7 23-26.1 40.8-26.1h23c21.4 0 39.2-17.8 39.2-39.2v-88.8c0-21.4-17.8-39.2-39.2-39.2h-21.4c-18.3 0-34.5-11-41.3-28.2-0.5-1-0.5-1.6-1-2.6-7.3-16.7-3.7-35.5 8.9-48.6l15.7-16.2c7.8-7.8 12.5-18.8 12.5-29.8 0-11.5-4.2-21.9-12-29.8l-59.6-59c-16.2-16.2-42.8-16.2-59 0l-17.2 16.2c-13.1 12.5-32.4 15.7-48.6 8.9-0.5-0.5-1.6-0.5-2.6-1-17.2-6.8-28.2-23-28.2-41.3v-21.4c0-21.4-17.8-39.2-39.2-39.2h-83.6c-24.6 0-44.4 19.9-44.4 44.4v17.8c0 17.8-10.4 33.4-26.6 40.8-17.2 7.8-37.1 3.7-50.2-9.4l-15.2-15.7c-7.8-7.8-18.3-12-29.3-12-11 0-21.4 4.2-29.3 12l-59 59c-16.2 16.2-16.2 42.8 0 59l16.2 17.2c12.5 13.1 16.2 32.4 8.9 48.6-0.5 0.5-0.5 1.6-1 2.6-6.8 17.2-23 28.2-41.3 28.2h-21.4c-24.6 0-44.4 19.9-44.4 44.4v78.4c0 24.6 19.9 44.4 44.4 44.4h23c17.8 0 33.4 10.4 40.8 26.6v0.5c7.3 16.7 3.7 37.1-9.4 49.6l-15.7 15.2c-16.2 16.2-16.2 42.3 0 58.5l59 59c7.8 7.8 18.3 12 29.3 12 11 0 21.4-4.2 29.8-12.5l14.1-14.6c13.1-13.6 32.9-17.8 50.2-9.9l1 0.5z"/>
    </svg>
  </button>
</div>

<div id="messages">
  <div class="empty-state" id="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.13L4 20l1-4.6A8 8 0 1 1 21 12z"/>
    </svg>
    <h2>开始与 AI 助手对话</h2>
    <p>从题面工具栏选择 AI 操作，或在下方输入问题</p>
  </div>
</div>

<div id="error"></div>

<div class="composer">
  <div class="composer-row">
    <textarea id="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
    <button class="send-btn" id="sendBtn" title="发送" disabled>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 8L2.5 2.5L4.5 8L2.5 13.5z"/>
        <path d="M4.5 8H14"/>
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

  const ICON_USER = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5a5 5 0 0 1 10 0"/></svg>';
  const ICON_AI = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8L2.5 2.5L4.5 8L2.5 13.5z"/><path d="M4.5 8H14"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>';

  let isStreaming = false;
  let currentAssistantBubble = null;
  let userScrolled = false;

  function clearEmpty() {
    const e = $('empty');
    if (e) e.remove();
  }

  function buildMsgNode(role, html) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const roleEl = document.createElement('div');
    roleEl.className = 'role';
    roleEl.innerHTML = (role === 'user' ? ICON_USER : ICON_AI) + '<span>' + (role === 'user' ? 'You' : 'Assistant') + '</span>';
    const bubble = document.createElement('div');
    bubble.className = 'bubble markdown-body';
    bubble.innerHTML = html;
    wrap.appendChild(roleEl);
    wrap.appendChild(bubble);
    return { wrap, bubble };
  }

  function appendMsgHtml(role, html) {
    clearEmpty();
    const { wrap, bubble } = buildMsgNode(role, html);
    $('messages').appendChild(wrap);
    scrollBottom();
    return bubble;
  }

  function startAssistantBubble() {
    clearEmpty();
    const { wrap, bubble } = buildMsgNode('assistant', '<div class="typing"><span></span><span></span><span></span></div>');
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
      btn.innerHTML = ICON_STOP;
    } else {
      btn.classList.remove('stop');
      btn.disabled = !$('input').value.trim();
      btn.title = '发送';
      btn.innerHTML = ICON_SEND;
    }
  }

  function showError(msg) {
    $('error').textContent = msg;
    $('error').style.display = 'block';
  }
  function clearError() {
    $('error').style.display = 'none';
  }

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
  $('clearBtn').onclick = () => vscode.postMessage({ kind: 'clear' });
  $('settingsBtn').onclick = () => vscode.postMessage({ kind: 'openSettings' });

  function renderEmpty() {
    $('messages').innerHTML = '<div class="empty-state" id="empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.13L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>' +
      '<h2>开始与 AI 助手对话</h2>' +
      '<p>从题面工具栏选择 AI 操作，或在下方输入问题</p>' +
      '</div>';
  }

  function setProfile(label) {
    const el = $('profileBadge');
    el.textContent = label || '未配置';
    el.classList.toggle('off', !label);
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.kind === 'init') {
      setProfile(m.profile);
      $('title').textContent = m.topic ? m.topic : 'Chat';
      $('messages').innerHTML = '';
      if (!m.history || m.history.length === 0) {
        renderEmpty();
      } else {
        for (const h of m.history) appendMsgHtml(h.role, h.html);
      }
    } else if (m.kind === 'state') {
      setProfile(m.profile);
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
