import * as vscode from 'vscode';
import type { WorkspaceMeta } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { escapeHtml } from '../utils/html.js';

export interface RenderProblemHtmlInput {
  problemRef: ProblemRef;
  meta?: WorkspaceMeta;
  /** 已渲染好的 HTML 主体(markdown-it 输出)。 */
  bodyHtml: string;
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  aiEnabled: boolean;
  nonce: string;
}

export function renderProblemHtml(input: RenderProblemHtmlInput): string {
  const { problemRef, meta, bodyHtml, webview, extensionUri, aiEnabled, nonce } = input;
  const katexCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'katex', 'katex.min.css'),
  );
  const cspSource = webview.cspSource;
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const title = meta?.title ?? `${problemRef.platform} ${problemRef.id}`;
  const platformLabel = problemRef.platform === 'leetcode-cn' ? 'LeetCode CN' : 'HDOJ';
  const difficulty = meta?.difficulty ? `<span class="badge diff-${escapeHtml(meta.difficulty.toLowerCase())}">${escapeHtml(meta.difficulty)}</span>` : '';
  const tags = (meta?.tags ?? [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');

  const aiBtnAttrs = aiEnabled ? '' : 'class="ai disabled" disabled';
  const aiBtnClass = aiEnabled ? 'ai' : 'ai disabled';

  return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${katexCssUri}" nonce="${nonce}" />
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; max-width: 980px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 18px; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .diff-easy, .diff-简单 { background: #198754; color: white; }
  .diff-medium, .diff-中等 { background: #fd7e14; color: white; }
  .diff-hard, .diff-困难 { background: #dc3545; color: white; }
  .tag { padding: 1px 6px; border-radius: 4px; font-size: 11px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); margin-right: 4px; }
  .toolbar { display: flex; gap: 6px; margin: 10px 0; flex-wrap: wrap; }
  .toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .toolbar button.ai { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .toolbar button.disabled { opacity: 0.45; cursor: not-allowed; }
  .toolbar .group { display: flex; gap: 4px; }
  .toolbar .sep { width: 1px; background: var(--vscode-panel-border); margin: 0 6px; }
  #content { margin-top: 12px; }
  pre, code { background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); border-radius: 3px; }
  pre { padding: 10px; overflow-x: auto; }
  code { padding: 1px 4px; }
  blockquote { border-left: 3px solid var(--vscode-panel-border); padding: 0 12px; color: var(--vscode-descriptionForeground); }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
</style></head><body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <span class="badge">${escapeHtml(platformLabel)}</span>
  <span class="badge">${escapeHtml(problemRef.id)}</span>
  ${difficulty}
</header>
<div>${tags}</div>
<div class="toolbar">
  <div class="group">
    <button data-cmd="judge.runAll">运行</button>
    <button data-cmd="submission.submit">提交</button>
    <button data-cmd="platform.refreshProblem">刷新</button>
    <button data-cmd="platform.openCode">打开代码</button>
    <button data-cmd="platform.openInBrowser">浏览器中打开</button>
  </div>
  <div class="sep"></div>
  <div class="group">
    <button class="${aiBtnClass}" data-ai="explainError" ${aiEnabled ? '' : 'disabled'}>AI · 解释错因</button>
    <button class="${aiBtnClass}" data-ai="generateApproach" ${aiEnabled ? '' : 'disabled'}>AI · 思路</button>
    <button class="${aiBtnClass}" data-ai="generateSolution" ${aiEnabled ? '' : 'disabled'}>AI · 题解</button>
    <button class="${aiBtnClass}" data-ai="explainCode" ${aiEnabled ? '' : 'disabled'}>AI · 解释代码</button>
  </div>
</div>
<div id="content">${bodyHtml}</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ref = ${JSON.stringify({ platform: problemRef.platform, id: problemRef.id, slug: problemRef.slug ?? '' })};
  let aiEnabled = ${aiEnabled ? 'true' : 'false'};
  document.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      vscode.postMessage({ type: 'cmd', cmd: b.getAttribute('data-cmd'), args: ref });
    });
  });
  document.querySelectorAll('button[data-ai]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!aiEnabled) return;
      const kind = b.getAttribute('data-ai');
      vscode.postMessage({ type: 'ai', kind, args: ref });
    });
  });
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m && m.type === 'aiAvailableChanged') {
      aiEnabled = !!m.enabled;
      document.querySelectorAll('button[data-ai]').forEach((b) => {
        if (aiEnabled) {
          b.classList.remove('disabled');
          b.removeAttribute('disabled');
        } else {
          b.classList.add('disabled');
          b.setAttribute('disabled', 'disabled');
        }
      });
    }
  });
</script></body></html>`;
}
