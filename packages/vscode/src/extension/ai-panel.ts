import * as vscode from 'vscode';
import type { AIServices } from './services.js';
import { isRedactEnabled } from './services.js';
import { buildContext, tokenEstimate, RateLimitError, type AIContextInput } from '@oj-agent/core';

type WebviewMsgIn =
  | { kind: 'send'; system: string; user: string }
  | { kind: 'stop' }
  | { kind: 'openSettings' };

type WebviewMsgOut =
  | { kind: 'init'; profile: string | null; redact: boolean; system: string; user: string; tokenEstimate: number; warn?: string }
  | { kind: 'chunk'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string; httpStatus?: number; rateLimit?: number }
  | { kind: 'state'; profile: string | null; redact: boolean };

export class AIPanel {
  private static current?: AIPanel;
  private panel: vscode.WebviewPanel;
  private abortCtl: AbortController | null = null;
  private disposables: vscode.Disposable[] = [];

  private constructor(private readonly ctx: vscode.ExtensionContext, private readonly services: AIServices) {
    this.panel = vscode.window.createWebviewPanel(
      'ojAgent.aiPanel',
      'OJ-Agent · AI 助手',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
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
      AIPanel.current.prepare(input);
    } else {
      AIPanel.current.prepareEmpty();
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

  private prepare(input: AIContextInput): void {
    const { system, user } = buildContext(input);
    const active = this.services.profiles.getActive();
    const tokens = tokenEstimate(system + user);
    const warn = active && active.maxInputTokens && tokens > active.maxInputTokens
      ? `已超出 maxInputTokens (${tokens} > ${active.maxInputTokens})，发送前可在上方编辑提示词。`
      : undefined;
    this.postOut({
      kind: 'init',
      profile: active?.label ?? null,
      redact: isRedactEnabled(),
      system,
      user,
      tokenEstimate: tokens,
      warn,
    });
  }

  private prepareEmpty(): void {
    const active = this.services.profiles.getActive();
    const system = '你是一名资深算法竞赛教练。回答简洁、分点、用中文。代码块使用对应语言的高亮 fenced block。';
    const user = '';
    this.postOut({
      kind: 'init',
      profile: active?.label ?? null,
      redact: isRedactEnabled(),
      system,
      user,
      tokenEstimate: tokenEstimate(system),
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
    if (m.kind === 'send') {
      await this.runStream(m.system, m.user);
    }
  }

  private async runStream(system: string, user: string): Promise<void> {
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
    try {
      for await (const chunk of this.services.runner.run({
        profile,
        apiKey,
        system,
        user,
        signal: this.abortCtl.signal,
        redactEnabled: isRedactEnabled(),
      })) {
        if (chunk.type === 'text' && chunk.text) {
          this.postOut({ kind: 'chunk', text: chunk.text });
        } else if (chunk.type === 'done') {
          this.postOut({ kind: 'done' });
          return;
        } else if (chunk.type === 'error') {
          this.postOut({
            kind: 'error',
            message: chunk.error?.message ?? 'unknown error',
            httpStatus: chunk.error?.httpStatus,
          });
          return;
        }
      }
      this.postOut({ kind: 'done' });
    } catch (e) {
      if (e instanceof RateLimitError) {
        this.postOut({ kind: 'error', message: e.message, rateLimit: e.retryAfterSeconds });
      } else {
        this.postOut({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      this.abortCtl = null;
    }
  }

  private postOut(msg: WebviewMsgOut): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    this.abortCtl?.abort();
    this.abortCtl = null;
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
    return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  .badges { display: flex; gap: 6px; margin-bottom: 8px; font-size: 11px; }
  .badge { padding: 2px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge.warn { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  details { margin: 8px 0; }
  textarea { width: 100%; box-sizing: border-box; min-height: 120px; font-family: var(--vscode-editor-font-family); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 4px 10px; cursor: pointer; margin-right: 6px; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #out { white-space: pre-wrap; padding: 8px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); min-height: 60px; margin-top: 10px; }
  #err { color: var(--vscode-errorForeground); margin-top: 8px; display: none; }
  .meta { font-size: 11px; opacity: 0.7; margin-top: 4px; }
</style></head><body>
<div class="badges">
  <span class="badge" id="profileBadge">Profile: --</span>
  <span class="badge warn" id="redactBadge" style="display:none">脱敏 OFF</span>
  <span class="badge" id="tokensBadge">~0 tokens</span>
</div>
<details open>
  <summary>提示词预览 / 编辑</summary>
  <div class="meta">system</div>
  <textarea id="sys"></textarea>
  <div class="meta">user</div>
  <textarea id="usr" style="min-height:200px"></textarea>
  <div id="warn" class="meta" style="color: var(--vscode-inputValidation-warningForeground)"></div>
</details>
<div>
  <button id="send">发送</button>
  <button id="stop" class="secondary" disabled>停止生成</button>
  <button id="retry" class="secondary" style="display:none">重试</button>
</div>
<div id="err"></div>
<div id="out"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let lastSys = '', lastUsr = '';
  function setSending(b) {
    $('send').disabled = b;
    $('stop').disabled = !b;
    $('retry').style.display = 'none';
  }
  $('send').onclick = () => {
    lastSys = $('sys').value; lastUsr = $('usr').value;
    $('out').textContent = ''; $('err').style.display = 'none';
    setSending(true);
    vscode.postMessage({ kind: 'send', system: lastSys, user: lastUsr });
  };
  $('stop').onclick = () => vscode.postMessage({ kind: 'stop' });
  $('retry').onclick = () => {
    $('out').textContent = ''; $('err').style.display = 'none';
    setSending(true);
    vscode.postMessage({ kind: 'send', system: lastSys, user: lastUsr });
  };
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.kind === 'init') {
      $('sys').value = m.system; $('usr').value = m.user;
      $('profileBadge').textContent = 'Profile: ' + (m.profile || '未配置');
      $('redactBadge').style.display = m.redact ? 'none' : 'inline-block';
      $('tokensBadge').textContent = '~' + m.tokenEstimate + ' tokens';
      $('warn').textContent = m.warn || '';
    } else if (m.kind === 'state') {
      $('profileBadge').textContent = 'Profile: ' + (m.profile || '未配置');
      $('redactBadge').style.display = m.redact ? 'none' : 'inline-block';
    } else if (m.kind === 'chunk') {
      $('out').textContent += m.text;
    } else if (m.kind === 'done') {
      setSending(false);
    } else if (m.kind === 'error') {
      setSending(false);
      let txt = m.message;
      if (m.httpStatus === 401) txt = '鉴权失败 (HTTP 401)：请检查 API Key';
      else if (m.httpStatus) txt = 'HTTP ' + m.httpStatus + ': ' + m.message;
      else if (m.rateLimit) txt = '速率限制：' + m.rateLimit + ' 秒后重试';
      $('err').textContent = txt; $('err').style.display = 'block';
      $('retry').style.display = 'inline-block';
    }
  });
</script></body></html>`;
  }
}
