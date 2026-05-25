import * as vscode from 'vscode';
import type { WorkspaceMeta, JudgeLang } from '@oj-agent/core';
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
  currentLang: JudgeLang;
  /**
   * 该题真实可选语言列表（来自 adapter.getProblemLangs?）。
   *
   * - 未提供（adapter 未实现 getProblemLangs 或调用失败）：渲染兜底的 4 种语言菜单
   * - 提供且非空：仅渲染列表内的语言；若 currentLang 不在列表内，仍保留高亮但提示不支持
   * - 提供且为空：表示该题平台支持的语言全部不在本地 JudgeLang 子集内；菜单只剩 currentLang，应配合 unsupportedReason 提示
   */
  availableLangs?: ReadonlyArray<{ lang: JudgeLang; displayName: string }>;
  /** 当 availableLangs 为空数组时，向用户解释“为什么菜单这么少”。例如：“该题平台仅支持 mysql/oracle 等数据库语言（本地工具链暂不支持）”。 */
  unsupportedReason?: string;
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

const LANG_LABELS: Record<JudgeLang, string> = {
  cpp: 'C++',
  c: 'C',
  python3: 'Python 3',
  java: 'Java',
  javascript: 'JavaScript',
};

export function renderProblemHtml(input: RenderProblemHtmlInput): string {
  const { problemRef, meta, bodyHtml, webview, extensionUri, aiEnabled, currentLang, availableLangs, unsupportedReason, nonce } = input;
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
  .btn.icon-only {
    padding: 5px;
    width: 26px;
    height: 26px;
    justify-content: center;
  }
  .btn.icon-only .icon { width: 14px; height: 14px; }

  /* ── Menu dropdown (shared by AI / Lang) ── */
  .menu { position: relative; }
  .menu .chevron {
    width: 10px; height: 10px;
    transition: transform 0.15s;
    opacity: 0.7;
  }
  .menu.open .chevron { transform: rotate(180deg); }
  .menu .panel {
    display: none;
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    min-width: 140px;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--oj-bg)));
    color: var(--vscode-menu-foreground, var(--oj-fg));
    border: 1px solid var(--vscode-menu-border, var(--oj-border));
    border-radius: 4px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.32);
    padding: 4px;
    z-index: 10;
  }
  .menu.open .panel { display: block; }
  .menu .panel button {
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
  .menu .panel button:hover:not(:disabled) {
    background: var(--vscode-menu-selectionBackground, var(--oj-hover));
    color: var(--vscode-menu-selectionForeground, inherit);
  }
  .menu .panel button:disabled { opacity: 0.4; cursor: not-allowed; }
  .menu .panel button.selected { background: var(--oj-hover); }
  .menu .panel .lang-hint {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, var(--oj-fg-muted));
    border-bottom: 1px solid var(--oj-border);
    white-space: normal;
    line-height: 1.4;
    max-width: 260px;
  }

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
    <button class="btn" data-cmd="submission.submit" title="提交">
      <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3 8l5-5 5 5"/></svg>
      提交
    </button>
    <span class="sep"></span>
    <button class="btn icon-only" data-cmd="platform.openCode" title="打开代码">
      <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3M9.5 4l-3 8"/></svg>
    </button>
    <button class="btn icon-only" data-cmd="platform.revealProblemDir" title="在资源管理器中显示题目目录">
      <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5h4l1.5 1.5h7v7.5h-12.5z"/><path d="M1.5 4.5v9"/></svg>
    </button>
    <button class="btn icon-only" data-cmd="platform.refreshProblem" title="刷新题目">
      <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9M13.5 8a5.5 5.5 0 0 1-9.4 3.9"/><path d="M12 1.5v3h-3M4 14.5v-3h3"/></svg>
    </button>
    <button class="btn icon-only" data-cmd="platform.openInBrowser" title="在浏览器中打开">
      <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5"/><path d="M12 9.5v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>
    </button>
    <span class="spacer"></span>
    <div class="menu" id="langMenu">
      <button class="btn" id="langToggle" title="切换源代码语言">
        <span id="langLabel">${escapeHtml(LANG_LABELS[currentLang])}</span>
        <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>
      </button>
      <div class="panel">
        ${unsupportedReason ? `<div class="lang-hint">${escapeHtml(unsupportedReason)}</div>` : ''}
        ${renderLangButtons(currentLang, availableLangs)}
      </div>
    </div>
    <div class="menu" id="aiMenu">
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
      // 当前选中的语言（与顶部菜单同步）。后端命令路由可据此精准定位 solution.* 文件。
      const selected = document.querySelector('button[data-lang].selected');
      const lang = selected ? selected.getAttribute('data-lang') : null;
      vscode.postMessage({ type: 'cmd', cmd: b.getAttribute('data-cmd'), args: ref, lang });
    });
  });

  // ── Generic menu toggle (shared by AI + Lang) ──
  function bindMenu(rootId, toggleId) {
    const root = document.getElementById(rootId);
    const toggle = document.getElementById(toggleId);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (toggle.disabled) return;
      // close other menus
      document.querySelectorAll('.menu.open').forEach((m) => { if (m !== root) m.classList.remove('open'); });
      root.classList.toggle('open');
    });
  }
  bindMenu('aiMenu', 'aiToggle');
  bindMenu('langMenu', 'langToggle');
  document.addEventListener('click', () => {
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  });

  const aiMenu = document.getElementById('aiMenu');
  document.querySelectorAll('button[data-ai]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!aiEnabled || b.disabled) return;
      aiMenu.classList.remove('open');
      vscode.postMessage({ type: 'ai', kind: b.getAttribute('data-ai'), args: ref });
    });
  });

  const langMenu = document.getElementById('langMenu');
  const langLabel = document.getElementById('langLabel');
  document.querySelectorAll('button[data-lang]').forEach((b) => {
    b.addEventListener('click', () => {
      const value = b.getAttribute('data-lang');
      langMenu.classList.remove('open');
      langLabel.textContent = b.textContent;
      document.querySelectorAll('button[data-lang]').forEach((x) => x.classList.toggle('selected', x === b));
      vscode.postMessage({ type: 'lang', lang: value, args: ref });
    });
  });

  function setAiEnabled(on) {
    aiEnabled = !!on;
    const aiToggle = document.getElementById('aiToggle');
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

/**
 * 渲染语言菜单按钮列表。
 *
 * - availableLangs 为 undefined：adapter 未实现 getProblemLangs 或调用失败 → fallback 到 4 种内置默认语言
 * - availableLangs 为非空数组：仅渲染列表内语言（按入参顺序）
 * - availableLangs 为空数组：表示该题不被本地任何 JudgeLang 支持，菜单只显示 currentLang 兜底
 *
 * 任何情况下都保证 currentLang 在菜单内（避免用户看不到当前高亮状态）。
 */
function renderLangButtons(
  currentLang: JudgeLang,
  availableLangs: ReadonlyArray<{ lang: JudgeLang; displayName: string }> | undefined,
): string {
  const fallback: Array<{ lang: JudgeLang; displayName: string }> = [
    { lang: 'cpp', displayName: 'C++' },
    { lang: 'c', displayName: 'C' },
    { lang: 'python3', displayName: 'Python 3' },
    { lang: 'java', displayName: 'Java' },
    { lang: 'javascript', displayName: 'JavaScript' },
  ];
  // undefined → fallback 4+种；空数组 → 不 fallback（语义是“本地真没语言可用”）
  let list: Array<{ lang: JudgeLang; displayName: string }> =
    availableLangs === undefined ? fallback : [...availableLangs];
  // 保证 currentLang 始终在菜单里
  if (!list.some((l) => l.lang === currentLang)) {
    list = [{ lang: currentLang, displayName: LANG_LABELS[currentLang] }, ...list];
  }
  return list
    .map(
      (l) =>
        `<button data-lang="${escapeHtml(l.lang)}"${l.lang === currentLang ? ' class="selected"' : ''}>${escapeHtml(l.displayName)}</button>`,
    )
    .join('\n        ');
}
