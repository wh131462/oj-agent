import * as vscode from 'vscode';
import type { JudgeRunResult, JudgeCaseResult } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { escapeHtml } from '../utils/html.js';

export interface RenderJudgeHtmlInput {
  result?: JudgeRunResult;
  /** running 状态:无 result 时显示 spinner。 */
  running?: boolean;
  problemRef: ProblemRef;
  aiEnabled: boolean;
  webview: vscode.Webview;
  nonce: string;
}

export function renderJudgeHtml(input: RenderJudgeHtmlInput): string {
  const { result, running, problemRef, aiEnabled, webview, nonce } = input;
  const cspSource = webview.cspSource;
  const csp = [
    `default-src 'none'`,
    `style-src ${cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const platformLabel = platformDisplay(problemRef.platform);

  let body = '';
  if (running) {
    body = `
      <div class="state-empty">
        <div class="spinner"></div>
        <span class="state-text">正在编译并运行...</span>
      </div>`;
  } else if (!result) {
    body = `
      <div class="state-empty">
        <span class="state-text">尚未运行测试</span>
        <button class="btn-primary" data-cmd="judge.runAll">运行全部用例</button>
      </div>`;
  } else if (result.compileError) {
    const aiClass = aiEnabled ? 'btn-text ai-btn' : 'btn-text ai-btn disabled';
    const aiDisabled = aiEnabled ? '' : 'disabled';
    body = `
      <div class="compile-error">
        <div class="section-label error-label">编译错误</div>
        <pre class="output-block">${escapeHtml(result.compileError)}</pre>
        <div class="error-actions">
          <button class="${aiClass}" data-ai="explainError" ${aiDisabled}>✦ AI 分析</button>
        </div>
      </div>`;
  } else {
    const total = result.cases.length;
    const acCount = result.cases.filter((c) => c.verdict === 'AC').length;
    const totalTime = result.cases.reduce((sum, c) => sum + (c.timeMs ?? 0), 0);
    const allAC = acCount === total && total > 0;
    const pct = total > 0 ? Math.round((acCount / total) * 100) : 0;

    body = `
      <div class="summary-row">
        <span class="summary-verdict ${allAC ? 'verdict-ac' : 'verdict-wa'}">${allAC ? 'AC' : 'WA'}</span>
        <span class="summary-stat">${acCount} / ${total} 通过</span>
        <span class="summary-time">${totalTime}ms</span>
        <div class="summary-spacer"></div>
        <button class="btn-ghost" data-cmd="judge.runAll">重跑全部</button>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${allAC ? 'fill-ac' : 'fill-wa'}" style="width:${pct}%"></div>
      </div>
      <div class="cases">
        ${result.cases.map((c) => renderCase(c, problemRef, aiEnabled)).join('\n')}
      </div>`;
  }

  return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  :root {
    --c-ac: #4ade80;
    --c-wa: #f87171;
    --c-tle: #fbbf24;
    --c-re: #c084fc;
    --c-border: var(--vscode-widget-border, rgba(128,128,128,0.2));
    --c-surface: var(--vscode-editorWidget-background);
    --c-text: var(--vscode-foreground);
    --c-muted: var(--vscode-descriptionForeground);
    --c-primary: var(--vscode-button-background, #0e639c);
    --c-primary-fg: var(--vscode-button-foreground, #fff);
    --mono: var(--vscode-editor-font-family), 'Consolas', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--mono);
    color: var(--c-text);
    background: var(--vscode-editor-background);
    padding: 12px 14px;
    max-width: 860px;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.5;
  }

  /* header */
  .page-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--c-border);
    margin-bottom: 14px;
  }
  .header-title { font-size: 13px; font-weight: 600; }
  .header-meta { font-size: 11px; color: var(--c-muted); }

  /* state empty / running */
  .state-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 28px 0;
    color: var(--c-muted);
    font-size: 13px;
  }
  .spinner {
    width: 14px; height: 14px; flex-shrink: 0;
    border: 2px solid rgba(128,128,128,0.2);
    border-top-color: var(--c-muted);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* summary row */
  .summary-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .summary-verdict {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .verdict-ac { color: var(--c-ac); }
  .verdict-wa { color: var(--c-wa); }
  .summary-stat { font-size: 13px; font-weight: 500; }
  .summary-time { font-size: 12px; color: var(--c-muted); }
  .summary-spacer { flex: 1; }

  /* progress */
  .progress-bar {
    height: 2px;
    background: rgba(128,128,128,0.12);
    margin-bottom: 12px;
  }
  .progress-fill { height: 100%; transition: width 0.3s ease; }
  .fill-ac { background: var(--c-ac); }
  .fill-wa { background: var(--c-wa); }

  /* cases */
  .cases { display: flex; flex-direction: column; gap: 4px; }
  .case-card {
    border: 1px solid var(--c-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .case-card.verdict-ac { border-left-color: var(--c-ac); }
  .case-card.verdict-wa,
  .case-card.verdict-re,
  .case-card.verdict-ce { border-left-color: var(--c-wa); }
  .case-card.verdict-tle { border-left-color: var(--c-tle); }

  .case-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    cursor: pointer;
    user-select: none;
  }
  .case-head:hover { background: rgba(128,128,128,0.05); }

  .verdict-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    min-width: 28px;
  }
  .verdict-tag.AC { color: var(--c-ac); }
  .verdict-tag.WA { color: var(--c-wa); }
  .verdict-tag.TLE { color: var(--c-tle); }
  .verdict-tag.RE { color: var(--c-re); }
  .verdict-tag.CE { color: var(--c-wa); }

  .case-num { font-size: 12px; color: var(--c-muted); }
  .case-time { font-size: 11px; color: var(--c-muted); margin-left: 2px; }
  .case-actions { margin-left: auto; display: flex; gap: 4px; align-items: center; }
  .chevron {
    width: 12px; height: 12px;
    color: var(--c-muted);
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .case-card.open .chevron { transform: rotate(90deg); }

  .case-body {
    border-top: 1px solid var(--c-border);
    padding: 10px;
    display: none;
  }
  .case-card.open .case-body { display: block; }

  .io-block { margin-bottom: 8px; }
  .io-block:last-child { margin-bottom: 0; }
  .io-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--c-muted);
    margin-bottom: 3px;
  }
  pre {
    background: rgba(0,0,0,0.15);
    border: 1px solid var(--c-border);
    padding: 8px 10px;
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  .diff-add { color: var(--c-ac); }
  .diff-del { color: var(--c-wa); }

  /* compile error */
  .compile-error { }
  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .error-label { color: var(--c-wa); }
  .output-block { width: 100%; }
  .error-actions { margin-top: 8px; }

  /* buttons */
  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--c-primary);
    color: var(--c-primary-fg);
    border: none;
    padding: 6px 14px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .btn-primary:hover { opacity: 0.9; }

  .btn-ghost {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    color: var(--c-muted);
    border: 1px solid var(--c-border);
    padding: 4px 9px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
  }
  .btn-ghost:hover { color: var(--c-text); border-color: rgba(128,128,128,0.4); }

  .btn-text {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--c-muted);
  }
  .btn-text:hover { color: var(--c-text); }

  .ai-btn { color: var(--c-re); }
  .ai-btn:hover { color: #d8b4fe; }

  .disabled { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
</style></head><body>

<div class="page-header">
  <span class="header-title">本地测试</span>
  <span class="header-meta">${escapeHtml(platformLabel)} · ${escapeHtml(problemRef.id)}${problemRef.slug ? ` · ${escapeHtml(problemRef.slug)}` : ''}</span>
</div>

${body}

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ref = ${JSON.stringify({ platform: problemRef.platform, id: problemRef.id, slug: problemRef.slug ?? '' })};

  document.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      const idx = b.getAttribute('data-case-index');
      const args = idx ? { ...ref, caseIndex: Number(idx) } : ref;
      vscode.postMessage({ type: 'cmd', cmd: b.getAttribute('data-cmd'), args });
    });
  });

  document.querySelectorAll('button[data-ai]').forEach((b) => {
    if (b.classList.contains('disabled')) return;
    b.addEventListener('click', () => {
      const idx = b.getAttribute('data-case-index');
      const args = idx ? { ...ref, caseIndex: Number(idx) } : ref;
      vscode.postMessage({ type: 'ai', kind: b.getAttribute('data-ai'), args });
    });
  });

  document.querySelectorAll('.case-head[data-toggle]').forEach((h) => {
    h.addEventListener('click', () => {
      h.closest('.case-card').classList.toggle('open');
    });
  });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m && m.type === 'aiAvailableChanged') {
      const enabled = !!m.enabled;
      document.querySelectorAll('button[data-ai]').forEach((b) => {
        if (enabled) {
          b.classList.remove('disabled');
          b.removeAttribute('disabled');
          if (!b._bound) {
            b._bound = true;
            b.addEventListener('click', () => {
              const idx = b.getAttribute('data-case-index');
              const args = idx ? { ...ref, caseIndex: Number(idx) } : ref;
              vscode.postMessage({ type: 'ai', kind: b.getAttribute('data-ai'), args });
            });
          }
        } else {
          b.classList.add('disabled');
          b.setAttribute('disabled', 'disabled');
        }
      });
    }
  });
</script></body></html>`;
}

function platformDisplay(platform: string): string {
  const map: Record<string, string> = {
    'leetcode-cn': 'LeetCode CN',
    'hdoj': 'HDOJ',
    'codeforces': 'Codeforces',
    'luogu': '洛谷',
    'poj': 'POJ',
    'lanqiao': '蓝桥云课',
  };
  return map[platform] ?? platform;
}

function renderCase(c: JudgeCaseResult, _ref: ProblemRef, aiEnabled: boolean): string {
  const isFail = c.verdict !== 'AC';
  const aiClass = aiEnabled ? 'btn-text ai-btn' : 'btn-text ai-btn disabled';
  const aiDisabled = aiEnabled ? '' : 'disabled';
  const openClass = isFail ? 'open' : '';

  const inputSection = `
    <div class="io-block">
      <div class="io-label">输入</div>
      <pre>${escapeHtml(extractInput(c)) || '<em style="opacity:0.4">（无）</em>'}</pre>
    </div>`;

  const expectedSection = c.expected !== undefined ? `
    <div class="io-block">
      <div class="io-label">期望</div>
      <pre>${escapeHtml(c.expected)}</pre>
    </div>` : '';

  const actualSection = `
    <div class="io-block">
      <div class="io-label">实际</div>
      <pre>${escapeHtml(c.stdout)}</pre>
    </div>`;

  const stderrSection = c.stderr ? `
    <div class="io-block">
      <div class="io-label">stderr</div>
      <pre style="color:var(--c-wa)">${escapeHtml(c.stderr)}</pre>
    </div>` : '';

  const diffSection = c.diff ? `
    <div class="io-block">
      <div class="io-label">diff</div>
      <pre>${renderDiff(c.diff.unifiedDiff)}</pre>
    </div>` : '';

  return `
  <div class="case-card verdict-${c.verdict.toLowerCase()} ${openClass}">
    <div class="case-head" data-toggle>
      <span class="verdict-tag ${escapeHtml(c.verdict)}">${escapeHtml(c.verdict)}</span>
      <span class="case-num">#${c.index}</span>
      <span class="case-time">${c.timeMs ?? 0}ms</span>
      <div class="case-actions">
        <button class="btn-ghost" data-cmd="judge.runCase" data-case-index="${c.index}">重跑</button>
        ${isFail ? `<button class="${aiClass}" data-ai="explainError" data-case-index="${c.index}" ${aiDisabled}>✦ AI</button>` : ''}
      </div>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
      </svg>
    </div>
    <div class="case-body">
      ${inputSection}
      ${expectedSection}
      ${actualSection}
      ${stderrSection}
      ${diffSection}
    </div>
  </div>`;
}

function renderDiff(unified: string): string {
  return unified.split('\n').map((line) => {
    if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
    if (line.startsWith('-')) return `<span class="diff-del">${escapeHtml(line)}</span>`;
    return escapeHtml(line);
  }).join('\n');
}

function extractInput(_c: JudgeCaseResult): string {
  return '';
}
