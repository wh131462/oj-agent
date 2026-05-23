import * as vscode from 'vscode';
import type { WorkspaceMeta } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { escapeHtml } from '../utils/html.js';
import {
  getMarkdownAssetUris,
  buildMarkdownAssetLinks,
  getMarkdownStyleBlock,
} from './markdown.js';

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

const PLATFORM_LABELS: Record<string, string> = {
  'leetcode-cn': 'LeetCode CN',
  'hdoj': 'HDOJ',
  'codeforces': 'CF',
  'luogu': '洛谷',
  'poj': 'POJ',
  'lanqiao': '蓝桥',
};

export function renderProblemHtml(input: RenderProblemHtmlInput): string {
  const { problemRef, meta, bodyHtml, webview, extensionUri, aiEnabled, nonce } = input;
  const assetUris = getMarkdownAssetUris(webview, extensionUri);
  const cspSource = webview.cspSource;
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const title = meta?.title ?? `${problemRef.platform} ${problemRef.id}`;
  const platformLabel = PLATFORM_LABELS[problemRef.platform] ?? problemRef.platform;

  const difficultyMap: Record<string, string> = {
    easy: 'easy', '简单': 'easy',
    medium: 'medium', '中等': 'medium',
    hard: 'hard', '困难': 'hard',
  };
  const diffClass = meta?.difficulty ? (difficultyMap[meta.difficulty.toLowerCase()] ?? 'medium') : '';
  const diffLabel = meta?.difficulty ?? '';

  const metaParts: string[] = [escapeHtml(platformLabel), `#${escapeHtml(problemRef.id)}`];
  if (meta?.tags?.length) {
    metaParts.push(meta.tags.map((t) => escapeHtml(t)).join(', '));
  }
  const metaLine = metaParts.join(' · ');

  const aiDisabled = aiEnabled ? '' : 'disabled';

  return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
${buildMarkdownAssetLinks(assetUris)}
<style nonce="${nonce}">
${getMarkdownStyleBlock()}
  :root {
    --oj-fg: var(--vscode-foreground);
    --oj-fg-muted: var(--vscode-descriptionForeground);
    --oj-bg: var(--vscode-editor-background);
    --oj-border: var(--vscode-widget-border, rgba(128,128,128,0.18));
    --oj-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.08));
    --oj-accent: var(--vscode-textLink-foreground);
    --oj-easy:   #4ade80;
    --oj-medium: #fbbf24;
    --oj-hard:   #f87171;
    --oj-mono: var(--vscode-editor-font-family), ui-monospace, 'SF Mono', Consolas, monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    background: var(--oj-bg);
    color: var(--oj-fg);
    font-size: 13px;
    line-height: 1.6;
  }

  .page {
    max-width: 880px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }

  /* ── Header ── */
  header { margin-bottom: 18px; }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 4px;
  }

  h1.title {
    font-size: 20px;
    font-weight: 600;
    color: var(--oj-fg);
    letter-spacing: -0.2px;
  }

  .difficulty {
    font-size: 12px;
    font-weight: 600;
    text-transform: capitalize;
    flex-shrink: 0;
  }
  .difficulty.easy   { color: var(--oj-easy); }
  .difficulty.medium { color: var(--oj-medium); }
  .difficulty.hard   { color: var(--oj-hard); }

  .meta {
    font-size: 12px;
    color: var(--oj-fg-muted);
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    padding: 10px 0;
    border-top: 1px solid var(--oj-border);
    border-bottom: 1px solid var(--oj-border);
    margin: 16px 0 20px;
  }

  .sep {
    width: 1px;
    height: 16px;
    background: var(--oj-border);
    margin: 0 6px;
  }

  .spacer { flex: 1; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--oj-fg);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) { background: var(--oj-hover); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .btn .icon { width: 12px; height: 12px; flex-shrink: 0; }

  /* ── AI dropdown ── */
  .ai-menu { position: relative; }
  .ai-menu .chevron {
    width: 10px; height: 10px;
    transition: transform 0.15s;
    opacity: 0.7;
  }
  .ai-menu.open .chevron { transform: rotate(180deg); }
  .ai-menu .panel {
    display: none;
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 160px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--oj-bg)));
    color: var(--vscode-menu-foreground, var(--oj-fg));
    border: 1px solid var(--vscode-menu-border, var(--oj-border));
    border-radius: 4px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.32);
    padding: 4px;
    z-index: 10;
  }
  .ai-menu.open .panel { display: block; }
  .ai-menu .panel button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
  }
  .ai-menu .panel button:hover:not(:disabled) {
    background: var(--vscode-menu-selectionBackground, var(--oj-hover));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .ai-menu .panel button:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Content ── 共享 .markdown-body 样式来自 markdown.ts，这里仅做题面字号微调 ── */
  #content.markdown-body {
    font-size: 14px;
    line-height: 1.75;
  }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style></head><body>
<div class="page">

  <header>
    <div class="title-row">
      <h1 class="title">${escapeHtml(title)}</h1>
      ${diffClass ? `<span class="difficulty ${escapeHtml(diffClass)}">${escapeHtml(diffLabel)}</span>` : ''}
    </div>
    <div class="meta">${metaLine}</div>
  </header>

  <div class="toolbar">
    <button class="btn primary" data-cmd="judge.runAll" title="运行测试用例">
      <svg class="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5V3z"/></svg>
      运行
    </button>
    <button class="btn" data-cmd="submission.submit" title="提交">提交</button>
    <span class="sep"></span>
    <button class="btn" data-cmd="platform.openCode" title="打开代码">代码</button>
    <button class="btn" data-cmd="platform.refreshProblem" title="刷新题目">刷新</button>
    <button class="btn" data-cmd="platform.openInBrowser" title="在浏览器中打开">浏览器</button>
    <span class="spacer"></span>
    <button class="btn" data-cmd="openDebugPanel" title="调试">调试</button>
    <div class="ai-menu" id="aiMenu">
      <button class="btn" id="aiToggle" ${aiDisabled} title="AI 助手">
        AI
        <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <div class="panel">
        <button data-ai="explainError" ${aiDisabled}>分析错因</button>
        <button data-ai="generateApproach" ${aiDisabled}>生成思路</button>
        <button data-ai="generateSolution" ${aiDisabled}>生成题解</button>
        <button data-ai="explainCode" ${aiDisabled}>解析代码</button>
      </div>
    </div>
  </div>

  <div id="content" class="markdown-body">${bodyHtml}</div>

</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ref = ${JSON.stringify({ platform: problemRef.platform, id: problemRef.id, slug: problemRef.slug ?? '' })};
  let aiEnabled = ${aiEnabled ? 'true' : 'false'};

  document.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      vscode.postMessage({ type: 'cmd', cmd: b.getAttribute('data-cmd'), args: ref });
    });
  });

  const aiMenu = document.getElementById('aiMenu');
  const aiToggle = document.getElementById('aiToggle');
  aiToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (aiToggle.disabled) return;
    aiMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => aiMenu.classList.remove('open'));

  document.querySelectorAll('button[data-ai]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!aiEnabled || b.disabled) return;
      aiMenu.classList.remove('open');
      vscode.postMessage({ type: 'ai', kind: b.getAttribute('data-ai'), args: ref });
    });
  });

  function setAiEnabled(on) {
    aiEnabled = !!on;
    const toggle = (b) => {
      if (aiEnabled) b.removeAttribute('disabled');
      else b.setAttribute('disabled', 'disabled');
    };
    toggle(aiToggle);
    document.querySelectorAll('button[data-ai]').forEach(toggle);
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m && m.type === 'aiAvailableChanged') setAiEnabled(m.enabled);
  });
</script></body></html>`;
}
