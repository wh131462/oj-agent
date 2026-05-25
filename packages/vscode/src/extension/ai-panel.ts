import * as vscode from 'vscode';
import type { AIServices, Conversation, ConversationSummary, ProfileSummary } from './services.js';
import { isRedactEnabled } from './services.js';
import { buildContext, RateLimitError, type AIContextInput } from '@oj-agent/core';
import {
  renderMarkdown,
  getMarkdownAssetUris,
  buildMarkdownAssetLinks,
  getMarkdownStyleBlock,
} from './webview-content/markdown.js';

type WebviewMsgIn =
  | { kind: 'send'; text: string }
  | { kind: 'stop' }
  | { kind: 'clear' }
  | { kind: 'openSettings' }
  | { kind: 'newConversation' }
  | { kind: 'switchConversation'; id: string }
  | { kind: 'renameConversation'; id: string; title: string }
  | { kind: 'deleteConversation'; id: string }
  | { kind: 'setActiveProfile'; id: string };

interface RenderedMessage {
  role: 'user' | 'assistant';
  html: string;
}

type WebviewMsgOut =
  | {
      kind: 'init';
      profile: string | null;
      redact: boolean;
      profiles: ProfileSummary[];
      activeProfileId: string;
      conversations: ConversationSummary[];
      currentId: string;
      topic: string;
      title: string;
      history: RenderedMessage[];
    }
  | { kind: 'userMsg'; conversationId: string; html: string }
  | { kind: 'assistantStart'; conversationId: string }
  | { kind: 'assistantHtml'; conversationId: string; html: string }
  | { kind: 'assistantDone'; conversationId: string; html: string }
  | { kind: 'cleared'; conversationId: string }
  | { kind: 'error'; conversationId: string; message: string; httpStatus?: number; rateLimit?: number }
  | {
      kind: 'conversationsUpdated';
      conversations: ConversationSummary[];
      currentId: string;
    }
  | {
      kind: 'profilesUpdated';
      profiles: ProfileSummary[];
      activeProfileId: string;
      profileLabel: string | null;
      redact: boolean;
    };

const DEFAULT_SYSTEM_PROMPT = '你是一名资深算法竞赛教练。回答简洁、分点、用中文。代码块使用对应语言的高亮 fenced block。支持用户多轮追问，结合上下文给出准确解答。';
const STREAM_RENDER_INTERVAL_MS = 80;

interface StreamingState {
  conversationId: string;
  accumulated: string;
  abort: AbortController;
  renderTimer: ReturnType<typeof setTimeout> | null;
}

export class AIPanel {
  private static current?: AIPanel;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  /** 当前正在查看的会话 id（webview 主视图） */
  private currentId: string | null = null;
  /** 所有进行中的流式任务，按 conversationId 索引 */
  private streams = new Map<string, StreamingState>();

  private constructor(private readonly ctx: vscode.ExtensionContext, private readonly services: AIServices) {
    this.panel = vscode.window.createWebviewPanel(
      'ojAgent.aiPanel',
      'OJ-Agent:AI 助手',
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

    // ConversationStore 变更时刷新 webview 侧栏（保持轻量：仅推 summaries）
    this.disposables.push(
      services.conversations.onChange(() => {
        this.postOut({
          kind: 'conversationsUpdated',
          conversations: services.conversations.list(),
          currentId: this.currentId ?? '',
        });
      }),
    );
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

  static openNew(ctx: vscode.ExtensionContext, services: AIServices): AIPanel | undefined {
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
    void AIPanel.current.createAndShowNew();
    return AIPanel.current;
  }

  /** 全局 Profile 切换或脱敏配置变化时刷新 webview */
  static refreshState(services: AIServices): void {
    if (!AIPanel.current) return;
    const active = services.profiles.getActive();
    AIPanel.current.postOut({
      kind: 'profilesUpdated',
      profiles: AIPanel.current.collectProfiles(),
      activeProfileId: active?.id ?? '',
      profileLabel: active?.label ?? null,
      redact: isRedactEnabled(),
    });
  }

  // ─── private: 会话准备 ──────────────────────────────

  private collectProfiles(): ProfileSummary[] {
    return this.services.profiles.list().map((p) => ({ id: p.id, label: p.label }));
  }

  /** 从题面工具栏触发：构造首条 user 消息，新建会话并发起请求 */
  private async prepare(input: AIContextInput): Promise<void> {
    const { system, user } = buildContext(input);
    const topic = input.problem?.title ?? '';
    if (topic) this.panel.title = topic;

    const active = this.services.profiles.getActive();
    const conv = this.services.conversations.create({
      title: topic || '新对话',
      topic,
      systemPrompt: system,
      profileId: active?.id ?? '',
    });
    this.currentId = conv.id;
    await this.pushInit(conv);
    await this.sendUser(user);
  }

  /** 通过命令面板/openPanel 打开：取最近会话或新建一个空会话 */
  private async prepareEmpty(): Promise<void> {
    const latest = this.services.conversations.latest();
    if (latest) {
      this.currentId = latest.id;
      if (latest.topic) this.panel.title = latest.topic;
      await this.pushInit(latest);
    } else {
      await this.createAndShowNew();
    }
  }

  private async createAndShowNew(): Promise<void> {
    const active = this.services.profiles.getActive();
    const conv = this.services.conversations.create({
      title: '新对话',
      topic: '',
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      profileId: active?.id ?? '',
    });
    this.currentId = conv.id;
    this.panel.title = 'OJ-Agent:AI 助手';
    await this.pushInit(conv);
  }

  private async pushInit(conv: Conversation): Promise<void> {
    const renderedHistory: RenderedMessage[] = await Promise.all(
      conv.messages.map(async (m) => ({ role: m.role, html: await renderMarkdown(m.content) })),
    );
    const active = this.services.profiles.getActive();
    this.postOut({
      kind: 'init',
      profile: active?.label ?? null,
      redact: isRedactEnabled(),
      profiles: this.collectProfiles(),
      activeProfileId: active?.id ?? '',
      conversations: this.services.conversations.list(),
      currentId: conv.id,
      topic: conv.topic,
      title: conv.title,
      history: renderedHistory,
    });
    // 若该会话仍在后台流式生成，把累积内容补渲染一次，让 UI 恢复 streaming 状态
    const live = this.streams.get(conv.id);
    if (live) {
      this.postOut({ kind: 'assistantStart', conversationId: conv.id });
      if (live.accumulated) {
        const html = await renderMarkdown(live.accumulated);
        this.postOut({ kind: 'assistantHtml', conversationId: conv.id, html });
      }
    }
  }

  // ─── private: webview 消息处理 ──────────────────────

  private async onMessage(m: WebviewMsgIn): Promise<void> {
    switch (m.kind) {
      case 'stop':
        if (this.currentId) this.streams.get(this.currentId)?.abort.abort();
        return;
      case 'openSettings':
        void vscode.commands.executeCommand('ojAgent.ai.openSettings');
        return;
      case 'clear':
        await this.handleClear();
        return;
      case 'send':
        await this.sendUser(m.text);
        return;
      case 'newConversation':
        await this.createAndShowNew();
        return;
      case 'switchConversation':
        await this.switchConversation(m.id);
        return;
      case 'renameConversation':
        this.services.conversations.setTitle(m.id, m.title);
        return;
      case 'deleteConversation':
        await this.deleteConversation(m.id);
        return;
      case 'setActiveProfile':
        await this.services.profiles.setActive(m.id);
        AIPanel.refreshState(this.services);
        return;
    }
  }

  private async handleClear(): Promise<void> {
    if (!this.currentId) return;
    const confirm = await vscode.window.showWarningMessage(
      '确认清空当前对话？',
      { modal: true },
      '清空',
    );
    if (confirm !== '清空') return;
    const id = this.currentId;
    this.streams.get(id)?.abort.abort();
    this.services.conversations.clearMessages(id);
    this.postOut({ kind: 'cleared', conversationId: id });
  }

  private async switchConversation(id: string): Promise<void> {
    if (id === this.currentId) return;
    const conv = this.services.conversations.get(id);
    if (!conv) return;
    // 不 abort 离开会话的流：后台继续生成，commit 时仍写入原会话
    this.currentId = id;
    if (conv.topic) this.panel.title = conv.topic;
    else this.panel.title = conv.title || 'OJ-Agent:AI 助手';
    await this.pushInit(conv);
  }

  private async deleteConversation(id: string): Promise<void> {
    const conv = this.services.conversations.get(id);
    if (!conv) return;
    const confirm = await vscode.window.showWarningMessage(
      `确认删除会话 "${conv.title}"？`,
      { modal: true },
      '删除',
    );
    if (confirm !== '删除') return;
    this.streams.get(id)?.abort.abort();
    this.streams.delete(id);
    this.services.conversations.remove(id);
    if (this.currentId === id) {
      const next = this.services.conversations.latest();
      if (next) {
        this.currentId = next.id;
        await this.pushInit(next);
      } else {
        await this.createAndShowNew();
      }
    }
  }

  // ─── private: 发送与流式 ────────────────────────────

  private async sendUser(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = this.currentId;
    if (!id) return;
    this.services.conversations.appendMessage(id, { role: 'user', content: trimmed });
    const html = await renderMarkdown(trimmed);
    this.postOut({ kind: 'userMsg', conversationId: id, html });
    await this.runStream(id);
  }

  private composeUserPrompt(conv: Conversation): string {
    if (conv.messages.length === 1) return conv.messages[0]!.content;
    const lines: string[] = [];
    for (const m of conv.messages) {
      if (m.role === 'user') lines.push(`用户：${m.content}`);
      else lines.push(`助手：${m.content}`);
    }
    lines.push('助手：');
    return lines.join('\n\n');
  }

  private async runStream(conversationId: string): Promise<void> {
    const profile = this.services.profiles.getActive();
    if (!profile) {
      this.postOut({ kind: 'error', conversationId, message: '当前无可用 Profile' });
      return;
    }
    const apiKey = await this.services.vault.get(profile.id);
    if (!apiKey) {
      this.postOut({
        kind: 'error',
        conversationId,
        message: `Profile "${profile.label}" 未配置 API Key`,
      });
      return;
    }
    const conv = this.services.conversations.get(conversationId);
    if (!conv) return;

    // 已有该会话的流先中断
    this.streams.get(conversationId)?.abort.abort();
    const state: StreamingState = {
      conversationId,
      accumulated: '',
      abort: new AbortController(),
      renderTimer: null,
    };
    this.streams.set(conversationId, state);
    this.postOut({ kind: 'assistantStart', conversationId });

    try {
      for await (const chunk of this.services.runner.run({
        profile,
        apiKey,
        system: conv.systemPrompt,
        user: this.composeUserPrompt(conv),
        signal: state.abort.signal,
        redactEnabled: isRedactEnabled(),
      })) {
        if (chunk.type === 'text' && chunk.text) {
          state.accumulated += chunk.text;
          this.scheduleStreamRender(state);
        } else if (chunk.type === 'done') {
          await this.commitAssistant(state);
          return;
        } else if (chunk.type === 'error') {
          this.cancelStreamRender(state);
          this.postOut({
            kind: 'error',
            conversationId,
            message: chunk.error?.message ?? 'unknown error',
            httpStatus: chunk.error?.httpStatus,
          });
          return;
        }
      }
      await this.commitAssistant(state);
    } catch (e) {
      this.cancelStreamRender(state);
      if (state.abort.signal.aborted) {
        // 用户切走/删除/清空触发的中断 — 把已累积内容写入原会话作为收尾
        await this.commitAssistant(state);
        return;
      }
      if (e instanceof RateLimitError) {
        this.postOut({
          kind: 'error',
          conversationId,
          message: e.message,
          rateLimit: e.retryAfterSeconds,
        });
      } else {
        this.postOut({
          kind: 'error',
          conversationId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      // 流结束（无论正常/异常）从 streams 表移除（注意：commitAssistant 内已写入）
      const cur = this.streams.get(conversationId);
      if (cur === state) this.streams.delete(conversationId);
    }
  }

  private scheduleStreamRender(state: StreamingState): void {
    if (state.renderTimer) return;
    state.renderTimer = setTimeout(() => {
      state.renderTimer = null;
      void this.flushStreamRender(state);
    }, STREAM_RENDER_INTERVAL_MS);
  }

  private async flushStreamRender(state: StreamingState): Promise<void> {
    if (!state.accumulated) return;
    // 始终推送：webview 端通过 conversationId 自行决定是否应用 — 切走的会话静默忽略
    const html = await renderMarkdown(state.accumulated);
    this.postOut({ kind: 'assistantHtml', conversationId: state.conversationId, html });
  }

  private cancelStreamRender(state: StreamingState): void {
    if (state.renderTimer) {
      clearTimeout(state.renderTimer);
      state.renderTimer = null;
    }
  }

  private async commitAssistant(state: StreamingState): Promise<void> {
    this.cancelStreamRender(state);
    const final = state.accumulated;
    if (final) {
      this.services.conversations.appendMessage(state.conversationId, {
        role: 'assistant',
        content: final,
      });
    }
    const html = final ? await renderMarkdown(final) : '';
    this.postOut({ kind: 'assistantDone', conversationId: state.conversationId, html });
  }

  private postOut(msg: WebviewMsgOut): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    for (const s of this.streams.values()) {
      s.abort.abort();
      if (s.renderTimer) clearTimeout(s.renderTimer);
    }
    this.streams.clear();
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
    --bg-active: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,0.2));
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
    overflow: hidden;
  }

  /* ── Header ── */
  .chat-header {
    display: flex;
    align-items: center;
    gap: 4px;
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
    margin-left: 2px;
  }
  .icon-btn {
    width: 28px; height: 28px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent;
    color: var(--fg-muted);
    border: 0;
    cursor: pointer;
    border-radius: 5px;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--fg); }
  .icon-btn.active { background: var(--bg-hover); color: var(--fg); }
  .icon-btn svg { width: 15px; height: 15px; stroke-width: 1.6; }

  /* ── History popover ── */
  .history-popover {
    position: fixed;
    top: 44px;
    left: 12px;
    width: 280px;
    max-height: 60vh;
    background: var(--vscode-menu-background, var(--bg-soft));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.32);
    overflow: hidden;
    display: none;
    flex-direction: column;
    z-index: 20;
  }
  .history-popover.open { display: flex; }
  .history-popover-header {
    padding: 6px 10px;
    font-size: 10px;
    font-weight: 600;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .history-empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 11px;
  }
  .conv-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    cursor: pointer;
    position: relative;
  }
  .conv-item:hover { background: var(--bg-hover); }
  .conv-item.active { background: var(--bg-active); }
  .conv-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .conv-title[contenteditable="true"] {
    background: var(--bg-input);
    outline: 1px solid var(--focus);
    border-radius: 2px;
    padding: 1px 4px;
    text-overflow: clip;
  }
  .conv-time {
    font-size: 10px;
    color: var(--fg-muted);
    flex-shrink: 0;
  }
  .conv-actions {
    display: none;
    gap: 1px;
    flex-shrink: 0;
  }
  .conv-item:hover .conv-actions { display: inline-flex; }
  .conv-item:hover .conv-time { display: none; }
  .conv-actions .icon-btn { width: 20px; height: 20px; }
  .conv-actions .icon-btn svg { width: 11px; height: 11px; }

  /* ── Messages ── */
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .msg {
    display: flex;
    max-width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .msg.user { justify-content: flex-end; }
  .msg.assistant { justify-content: flex-start; }
  .msg .bubble {
    max-width: min(92%, 720px);
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .msg.user .bubble {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 12px 12px 4px 12px;
    padding: 8px 12px;
  }
  .msg.assistant .bubble {
    padding: 2px 0;
    width: 100%;
    max-width: 100%;
  }
  .bubble.markdown-body > :first-child { margin-top: 0; }
  .bubble.markdown-body > :last-child { margin-bottom: 0; }

  .typing { display: inline-flex; gap: 4px; padding: 6px 0; }
  .typing span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--fg-muted);
    animation: typing 1.2s infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

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

  /* ── Composer card ── */
  .composer-wrap {
    padding: 6px 12px 12px;
    flex-shrink: 0;
  }
  .composer-card {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 10px 6px;
    transition: border-color 0.15s;
  }
  .composer-card:focus-within { border-color: var(--focus); }
  #input {
    width: 100%;
    background: transparent;
    color: var(--vscode-input-foreground);
    border: 0;
    outline: none;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    padding: 2px 0 4px;
    max-height: 200px;
    min-height: 24px;
    display: block;
  }
  .composer-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    margin-top: 2px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 9px 0 8px;
    border-radius: 12px;
    background: var(--bg-soft);
    color: var(--fg);
    border: 1px solid var(--border);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    position: relative;
  }
  .chip:hover { background: var(--bg-hover); border-color: var(--focus); }
  .chip .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #4ade80;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px rgba(74,222,128,0.18);
  }
  .chip .dot.off { background: var(--fg-muted); opacity: 0.5; box-shadow: none; }
  .chip .profile-label {
    font-weight: 500;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip select.profile-select {
    /* 完全隐藏原生 select，仅作为数据源占位；交互通过自定义弹层完成 */
    display: none;
  }
  .chip.disabled { cursor: not-allowed; opacity: 0.7; }
  .chip .caret {
    font-size: 9px;
    opacity: 0.6;
    margin-left: 1px;
    transition: transform 0.15s;
  }
  .chip.open .caret { transform: rotate(180deg); opacity: 0.9; }

  .profile-popover {
    position: fixed;
    min-width: 200px;
    max-width: 280px;
    max-height: 50vh;
    background: var(--vscode-menu-background, var(--bg-soft));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.32);
    overflow: hidden;
    display: none;
    flex-direction: column;
    z-index: 20;
    padding: 4px 0;
  }
  .profile-popover.open { display: flex; }
  .profile-popover-empty {
    padding: 14px 12px;
    text-align: center;
    color: var(--fg-muted);
    font-size: 11px;
  }
  .profile-list {
    overflow-y: auto;
    padding: 0;
  }
  .profile-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--fg);
    user-select: none;
  }
  .profile-item:hover { background: var(--bg-hover); }
  .profile-item .check {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--focus);
    opacity: 0;
  }
  .profile-item.active .check { opacity: 1; }
  .profile-item .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .profile-item .meta {
    font-size: 10px;
    color: var(--fg-muted);
    flex-shrink: 0;
  }
  .profile-popover-footer {
    border-top: 1px solid var(--border);
    padding: 6px 10px 6px 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .profile-popover-footer:hover { background: var(--bg-hover); color: var(--fg); }
  .profile-popover-footer svg { width: 12px; height: 12px; flex-shrink: 0; }
  .toolbar-spacer { flex: 1; }
  .send-btn {
    flex-shrink: 0;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 0;
    border-radius: 999px;
    width: 26px; height: 26px;
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
  .send-btn svg { width: 12px; height: 12px; }

  .popover-mask {
    position: fixed; inset: 0;
    background: transparent;
    display: none;
    z-index: 15;
  }
  .popover-mask.open { display: block; }
</style></head><body>
<div class="chat-header">
  <button class="icon-btn" id="historyBtn" title="历史会话">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
  </button>
  <h1 id="title">AI 助手</h1>
  <button class="icon-btn" id="newConvBtn" title="新建对话">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h7"/><path d="M19 3v6"/><path d="M16 6h6"/></svg>
  </button>
  <button class="icon-btn" id="clearBtn" title="清空当前对话">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
  </button>
  <button class="icon-btn" id="settingsBtn" title="AI 设置">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
</div>

<div class="popover-mask" id="popoverMask"></div>
<div class="history-popover" id="historyPopover">
  <div class="history-popover-header">对话历史</div>
  <div class="history-list" id="convList"></div>
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

<div class="composer-wrap">
  <div class="composer-card">
    <textarea id="input" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
    <div class="composer-toolbar">
      <span class="chip" id="profileChip" title="切换 AI Profile">
        <span class="dot" id="profileDot"></span>
        <span class="profile-label" id="profileLabel">未配置</span>
        <span class="caret">▾</span>
        <select class="profile-select" id="profileSelect" aria-label="AI Profile"></select>
      </span>
      <div class="profile-popover" id="profilePopover" role="listbox">
        <div class="profile-list" id="profileList"></div>
        <div class="profile-popover-footer" id="profileSettingsEntry" title="打开 AI 设置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>管理 AI Profile…</span>
        </div>
      </div>
      <span class="toolbar-spacer"></span>
      <button class="send-btn" id="sendBtn" title="发送" disabled>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const ICON_SEND = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg>';
  const ICON_DELETE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l0.8 8.2a1 1 0 0 0 1 0.8h2.4a1 1 0 0 0 1-0.8L11 5"/></svg>';

  let state = {
    streaming: false,
    currentId: '',
    conversations: [],
    profiles: [],
    activeProfileId: '',
    redact: true,
  };
  let currentAssistantBubble = null;
  let userScrolled = false;

  // ── history popover ──
  function setPopoverOpen(open) {
    $('historyPopover').classList.toggle('open', open);
    $('popoverMask').classList.toggle('open', open);
    $('historyBtn').classList.toggle('active', open);
  }
  $('historyBtn').onclick = (e) => {
    e.stopPropagation();
    const open = !$('historyPopover').classList.contains('open');
    setPopoverOpen(open);
  };
  $('popoverMask').onclick = () => {
    setPopoverOpen(false);
    setProfilePopoverOpen(false);
  };

  // ── conversation list ──
  function formatTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚';
    if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟';
    if (diff < 86_400_000) return Math.floor(diff / 3600_000) + ' 时';
    return new Date(ts).toLocaleDateString();
  }

  function renderConvList() {
    const root = $('convList');
    root.innerHTML = '';
    if (!state.conversations || state.conversations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '暂无历史会话';
      root.appendChild(empty);
      return;
    }
    for (const c of state.conversations) {
      const item = document.createElement('div');
      item.className = 'conv-item' + (c.id === state.currentId ? ' active' : '');
      item.dataset.id = c.id;

      const title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = c.title || '新对话';

      const time = document.createElement('span');
      time.className = 'conv-time';
      time.textContent = formatTime(c.updatedAt);

      const actions = document.createElement('span');
      actions.className = 'conv-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = '重命名';
      editBtn.innerHTML = ICON_EDIT;
      editBtn.onclick = (e) => { e.stopPropagation(); enterRename(item, c.id, title); };
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = '删除';
      delBtn.innerHTML = ICON_DELETE;
      delBtn.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ kind: 'deleteConversation', id: c.id }); };
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      item.appendChild(title);
      item.appendChild(time);
      item.appendChild(actions);

      item.onclick = () => {
        if (c.id !== state.currentId) vscode.postMessage({ kind: 'switchConversation', id: c.id });
        setPopoverOpen(false);
      };
      title.ondblclick = (e) => { e.stopPropagation(); enterRename(item, c.id, title); };

      root.appendChild(item);
    }
  }

  function enterRename(item, id, titleEl) {
    titleEl.setAttribute('contenteditable', 'true');
    titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const finish = (commit) => {
      titleEl.removeAttribute('contenteditable');
      titleEl.removeEventListener('blur', onBlur);
      titleEl.removeEventListener('keydown', onKey);
      if (commit) {
        const t = titleEl.textContent.trim();
        vscode.postMessage({ kind: 'renameConversation', id, title: t });
      } else {
        const existing = state.conversations.find((x) => x.id === id);
        if (existing) titleEl.textContent = existing.title;
      }
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    titleEl.addEventListener('blur', onBlur);
    titleEl.addEventListener('keydown', onKey);
  }

  // ── profile chip ──
  function renderProfileChip() {
    const sel = $('profileSelect');
    const label = $('profileLabel');
    const list = $('profileList');
    const chip = $('profileChip');
    sel.innerHTML = '';
    list.innerHTML = '';
    if (!state.profiles || state.profiles.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '未配置';
      sel.appendChild(opt);
      sel.disabled = true;
      label.textContent = '未配置';
      chip.classList.add('disabled');
      $('profileDot').classList.add('off');
      const empty = document.createElement('div');
      empty.className = 'profile-popover-empty';
      empty.textContent = '暂无可用 Profile，去设置添加';
      list.appendChild(empty);
      return;
    }
    let activeLabel = '';
    for (const p of state.profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      if (p.id === state.activeProfileId) {
        opt.selected = true;
        activeLabel = p.label;
      }
      sel.appendChild(opt);

      const item = document.createElement('div');
      item.className = 'profile-item' + (p.id === state.activeProfileId ? ' active' : '');
      item.setAttribute('role', 'option');
      item.dataset.id = p.id;
      const meta = p.provider || p.model || '';
      item.innerHTML =
        '<svg class="check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>'
        + '<span class="name"></span>'
        + (meta ? '<span class="meta"></span>' : '');
      item.querySelector('.name').textContent = p.label;
      if (meta) item.querySelector('.meta').textContent = meta;
      item.addEventListener('click', () => {
        setProfilePopoverOpen(false);
        if (p.id !== state.activeProfileId) {
          vscode.postMessage({ kind: 'setActiveProfile', id: p.id });
        }
      });
      list.appendChild(item);
    }
    sel.disabled = false;
    chip.classList.remove('disabled');
    label.textContent = activeLabel || state.profiles[0].label;
    $('profileDot').classList.remove('off');
  }
  function setProfilePopoverOpen(open) {
    const pop = $('profilePopover');
    const chip = $('profileChip');
    if (open) {
      const rect = chip.getBoundingClientRect();
      pop.style.visibility = 'hidden';
      pop.classList.add('open');
      const popRect = pop.getBoundingClientRect();
      pop.style.visibility = '';
      let top = rect.top - popRect.height - 6;
      if (top < 8) top = rect.bottom + 6;
      let left = rect.left;
      const maxLeft = window.innerWidth - popRect.width - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      pop.style.top = top + 'px';
      pop.style.left = left + 'px';
      $('popoverMask').classList.add('open');
      chip.classList.add('open');
    } else {
      pop.classList.remove('open');
      chip.classList.remove('open');
      if (!$('historyPopover').classList.contains('open')) {
        $('popoverMask').classList.remove('open');
      }
    }
  }
  $('profileChip').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !$('profilePopover').classList.contains('open');
    setProfilePopoverOpen(open);
  });
  $('profileSettingsEntry').addEventListener('click', (e) => {
    e.stopPropagation();
    setProfilePopoverOpen(false);
    vscode.postMessage({ kind: 'openSettings' });
  });

  // ── messages ──
  function clearEmpty() {
    const e = $('empty');
    if (e) e.remove();
  }

  function buildMsgNode(role, html) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble markdown-body';
    bubble.innerHTML = html;
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
    state.streaming = b;
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
  function clearError() { $('error').style.display = 'none'; }

  const input = $('input');
  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }
  input.addEventListener('input', () => {
    autoResize();
    if (!state.streaming) $('sendBtn').disabled = !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  function submit() {
    if (state.streaming) {
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
  $('newConvBtn').onclick = () => vscode.postMessage({ kind: 'newConversation' });

  function renderEmpty() {
    $('messages').innerHTML = '<div class="empty-state" id="empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.13L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>' +
      '<h2>开始与 AI 助手对话</h2>' +
      '<p>从题面工具栏选择 AI 操作，或在下方输入问题</p>' +
      '</div>';
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.kind === 'init') {
      state.currentId = m.currentId;
      state.conversations = m.conversations || [];
      state.profiles = m.profiles || [];
      state.activeProfileId = m.activeProfileId || '';
      state.redact = !!m.redact;
      $('title').textContent = m.topic || m.title || 'AI 助手';
      $('messages').innerHTML = '';
      currentAssistantBubble = null;
      setStreaming(false);
      clearError();
      if (!m.history || m.history.length === 0) {
        renderEmpty();
      } else {
        for (const h of m.history) appendMsgHtml(h.role, h.html);
      }
      renderConvList();
      renderProfileChip();
    } else if (m.kind === 'conversationsUpdated') {
      state.conversations = m.conversations || [];
      state.currentId = m.currentId || state.currentId;
      renderConvList();
    } else if (m.kind === 'profilesUpdated') {
      state.profiles = m.profiles || [];
      state.activeProfileId = m.activeProfileId || '';
      state.redact = !!m.redact;
      renderProfileChip();
    } else if (m.kind === 'userMsg') {
      if (m.conversationId !== state.currentId) return;
      appendMsgHtml('user', m.html);
    } else if (m.kind === 'assistantStart') {
      if (m.conversationId !== state.currentId) return;
      startAssistantBubble();
      setStreaming(true);
    } else if (m.kind === 'assistantHtml') {
      if (m.conversationId !== state.currentId) return;
      updateAssistantBubble(m.html);
    } else if (m.kind === 'assistantDone') {
      if (m.conversationId !== state.currentId) return;
      finalizeAssistant(m.html);
      setStreaming(false);
    } else if (m.kind === 'cleared') {
      if (m.conversationId !== state.currentId) return;
      renderEmpty();
      clearError();
      setStreaming(false);
    } else if (m.kind === 'error') {
      if (m.conversationId !== state.currentId) return;
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
