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
      <div class="state-card running">
        <div class="spinner-wrap">
          <div class="spinner"></div>
          <span class="state-text">正在编译并运行本地测试...</span>
        </div>
      </div>`;
  } else if (!result) {
    body = `
      <div class="state-card empty">
        <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
        </svg>
        <p class="state-text">尚未运行测试</p>
        <button class="btn-primary" data-cmd="judge.runAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
          </svg>
          运行全部用例
        </button>
      </div>`;
  } else if (result.compileError) {
    body = `
      <div class="state-card error">
        <div class="error-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <strong>编译错误</strong>
        </div>
        <pre class="error-output">${escapeHtml(result.compileError)}</pre>
        <div class="error-actions">
          <button class="btn-ghost ai-btn${aiEnabled ? '' : ' disabled'}" data-ai="explainError" ${aiEnabled ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            AI 分析错误
          </button>
        </div>
      </div>`;
  } else {
    const total = result.cases.length;
    const acCount = result.cases.filter((c) => c.verdict === 'AC').length;
    const totalTime = result.cases.reduce((sum, c) => sum + (c.timeMs ?? 0), 0);
    const allAC = acCount === total && total > 0;
    const pct = total > 0 ? Math.round((acCount / total) * 100) : 0;
    body = `
      <div class="summary-card ${allAC ? 'all-ac' : 'has-fail'}">
        <div class="summary-left">
          <div class="verdict-badge ${allAC ? 'ac' : 'wa'}">
            ${allAC
              ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`
              : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`
            }
          </div>
          <div class="summary-info">
            <div class="summary-title">${allAC ? '全部通过' : `${acCount} / ${total} 通过`}</div>
            <div class="summary-sub">总耗时 ${totalTime}ms &nbsp;·&nbsp; 通过率 ${pct}%</div>
          </div>
        </div>
        <div class="summary-actions">
          <button class="btn-ghost" data-cmd="judge.runAll">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            重跑全部
          </button>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${allAC ? 'ac' : 'wa'}" style="width:${pct}%"></div>
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
    --oj-primary: #3b9eff;
    --oj-primary-hover: #60b4ff;
    --oj-primary-dim: rgba(59, 158, 255, 0.12);
    --oj-primary-border: rgba(59, 158, 255, 0.3);
    --oj-success: #4ade80;
    --oj-success-dim: rgba(74, 222, 128, 0.15);
    --oj-success-border: rgba(74, 222, 128, 0.4);
    --oj-warning: #fbbf24;
    --oj-warning-dim: rgba(251, 191, 36, 0.15);
    --oj-error: #f87171;
    --oj-error-dim: rgba(248, 113, 113, 0.15);
    --oj-error-border: rgba(248, 113, 113, 0.4);
    --oj-purple: #a78bfa;
    --oj-purple-dim: rgba(167, 139, 250, 0.12);
    --oj-surface: var(--vscode-editorWidget-background);
    --oj-border: rgba(255, 255, 255, 0.08);
    --oj-text: var(--vscode-foreground);
    --oj-text-muted: var(--vscode-descriptionForeground);
    --oj-radius: 6px;
    --oj-mono: var(--vscode-editor-font-family), 'SF Mono', 'Consolas', monospace;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--oj-mono);
    color: var(--oj-text);
    background: var(--vscode-editor-background);
    padding: 12px 14px;
    max-width: 900px;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.5;
  }

  /* ── header ── */
  .page-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--oj-border);
    margin-bottom: 14px;
  }
  .header-sigil {
    font-size: 11px; font-weight: 700;
    color: var(--oj-primary); opacity: 0.8;
    flex-shrink: 0;
  }
  .header-title { font-size: 13px; font-weight: 600; margin: 0; }
  .chip {
    font-size: 11px; font-weight: 600;
    padding: 2px 8px; border-radius: 12px;
    border: 1px solid;
  }
  .chip.platform {
    background: var(--oj-primary-dim);
    color: var(--oj-primary);
    border-color: var(--oj-primary-border);
  }
  .chip.pid {
    background: rgba(255, 255, 255, 0.04);
    color: var(--oj-text-muted);
    border-color: var(--oj-border);
  }

  /* ── state cards ── */
  .state-card {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; padding: 36px 20px;
    border: 1px solid var(--oj-border);
    background: var(--oj-surface);
    text-align: center; margin-top: 4px;
    border-radius: var(--oj-radius);
  }
  .state-icon { width: 36px; height: 36px; opacity: 0.3; }
  .state-text { opacity: 0.6; font-size: 13px; }
  .spinner-wrap { display: flex; align-items: center; gap: 10px; }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(59, 158, 255, 0.2);
    border-top-color: var(--oj-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── summary card ── */
  .summary-card {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px;
    border: 1px solid var(--oj-border);
    background: var(--oj-surface);
    margin-bottom: 6px;
    border-radius: var(--oj-radius);
  }
  .summary-card.all-ac { border-left: 3px solid var(--oj-success); background: var(--oj-success-dim); }
  .summary-card.has-fail { border-left: 3px solid var(--oj-error); background: var(--oj-error-dim); }
  .summary-left { display: flex; align-items: center; gap: 12px; }
  .verdict-badge {
    width: 36px; height: 36px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .verdict-badge.ac { background: var(--oj-success-dim); color: var(--oj-success); }
  .verdict-badge.wa { background: var(--oj-error-dim); color: var(--oj-error); }
  .verdict-badge svg { width: 20px; height: 20px; stroke: currentColor; }
  .summary-title { font-size: 14px; font-weight: 600; }
  .summary-sub { font-size: 12px; opacity: 0.6; margin-top: 2px; }
  .summary-actions { display: flex; gap: 6px; }

  .progress-bar {
    height: 4px; background: rgba(255, 255, 255, 0.06);
    border-radius: 2px; margin-bottom: 12px; overflow: hidden;
  }
  .progress-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
  .progress-fill.ac { background: var(--oj-success); }
  .progress-fill.wa { background: var(--oj-error); }

  /* ── case card ── */
  .cases { display: flex; flex-direction: column; gap: 6px; }
  .case-card {
    border: 1px solid var(--oj-border);
    border-radius: var(--oj-radius);
    background: var(--oj-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .case-card:hover { border-color: rgba(255, 255, 255, 0.15); }
  .case-card.verdict-ac { border-left: 3px solid var(--oj-success); }
  .case-card.verdict-wa,
  .case-card.verdict-tle,
  .case-card.verdict-re,
  .case-card.verdict-ce { border-left: 3px solid var(--oj-error); }
  .case-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; cursor: pointer;
    user-select: none;
  }
  .case-head:hover { background: rgba(255, 255, 255, 0.03); }
  .verdict-chip {
    font-size: 11px; font-weight: 700;
    padding: 3px 8px; border-radius: 12px;
    border: 1px solid;
  }
  .verdict-chip.AC { background: var(--oj-success-dim); color: var(--oj-success); border-color: var(--oj-success-border); }
  .verdict-chip.WA { background: var(--oj-error-dim); color: var(--oj-error); border-color: var(--oj-error-border); }
  .verdict-chip.TLE { background: var(--oj-warning-dim); color: var(--oj-warning); border-color: rgba(251, 191, 36, 0.4); }
  .verdict-chip.RE { background: var(--oj-purple-dim); color: var(--oj-purple); border-color: rgba(167, 139, 250, 0.3); }
  .verdict-chip.CE { background: var(--oj-error-dim); color: var(--oj-error); border-color: var(--oj-error-border); }
  .case-num { font-size: 12px; font-weight: 500; }
  .case-time { font-size: 11px; opacity: 0.5; margin-left: 4px; }
  .case-actions { margin-left: auto; display: flex; gap: 4px; align-items: center; }
  .chevron {
    width: 14px; height: 14px; opacity: 0.4;
    transition: transform 0.2s; flex-shrink: 0;
  }
  .case-card.open .chevron { transform: rotate(90deg); }
  .case-body {
    border-top: 1px solid var(--oj-border);
    padding: 12px;
    display: none;
  }
  .case-card.open .case-body { display: block; }
  .io-block { margin-bottom: 10px; }
  .io-label { font-size: 11px; font-weight: 600; text-transform: uppercase; opacity: 0.5; margin-bottom: 4px; }
  pre {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--oj-border);
    padding: 10px; border-radius: var(--oj-radius);
    overflow-x: auto;
    font-family: var(--oj-mono);
    font-size: 12px; margin: 0;
    white-space: pre-wrap; word-break: break-all;
  }
  .diff-line-add { color: var(--oj-success); }
  .diff-line-del { color: var(--oj-error); }

  /* ── error card ── */
  .error-header { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--oj-error); margin-bottom: 10px; }
  .error-header svg { width: 18px; height: 18px; flex-shrink: 0; }
  .error-output { width: 100%; }
  .error-actions { margin-top: 10px; }

  /* ── buttons ── */
  .btn-primary {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--oj-primary); color: #fff;
    border: 0; padding: 8px 16px; border-radius: var(--oj-radius);
    cursor: pointer; font-size: 13px; font-weight: 600;
    transition: background 0.15s, transform 0.1s;
  }
  .btn-primary:hover { background: var(--oj-primary-hover); }
  .btn-primary:active { transform: scale(0.98); }
  .btn-primary svg { width: 14px; height: 14px; }

  .btn-ghost {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent;
    color: var(--oj-text-muted);
    border: 1px solid var(--oj-border);
    padding: 5px 10px; border-radius: var(--oj-radius);
    cursor: pointer; font-size: 12px;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn-ghost:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.15); color: var(--oj-text); }
  .btn-ghost svg { width: 13px; height: 13px; flex-shrink: 0; }

  .ai-btn {
    border-color: rgba(167, 139, 250, 0.3);
    color: var(--oj-purple);
  }
  .ai-btn:hover { background: var(--oj-purple-dim); border-color: rgba(167, 139, 250, 0.5); }
  .ai-btn svg { stroke: var(--oj-purple); }

  .btn-ghost.disabled,
  .ai-btn.disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-ghost.disabled:hover,
  .ai-btn.disabled:hover { background: transparent; border-color: var(--oj-border); }
</style></head><body>

<div class="page-header">
  <span class="header-sigil">&gt;_</span>
  <h2 class="header-title">本地测试</h2>
  <span class="chip platform">${escapeHtml(platformLabel)}</span>
  <span class="chip pid">${escapeHtml(problemRef.id)}</span>
  ${problemRef.slug ? `<span class="chip">${escapeHtml(problemRef.slug)}</span>` : ''}
</div>

${body}

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ref = ${JSON.stringify({ platform: problemRef.platform, id: problemRef.id, slug: problemRef.slug ?? '' })};

  // cmd buttons
  document.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      const idx = b.getAttribute('data-case-index');
      const args = idx ? { ...ref, caseIndex: Number(idx) } : ref;
      vscode.postMessage({ type: 'cmd', cmd: b.getAttribute('data-cmd'), args });
    });
  });

  // ai buttons
  document.querySelectorAll('button[data-ai]').forEach((b) => {
    if (b.classList.contains('disabled')) return;
    b.addEventListener('click', () => {
      const idx = b.getAttribute('data-case-index');
      const args = idx ? { ...ref, caseIndex: Number(idx) } : ref;
      vscode.postMessage({ type: 'ai', kind: b.getAttribute('data-ai'), args });
    });
  });

  // case accordion toggle
  document.querySelectorAll('.case-head[data-toggle]').forEach((h) => {
    h.addEventListener('click', () => {
      const card = h.closest('.case-card');
      card.classList.toggle('open');
    });
  });

  // ai available changes
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m && m.type === 'aiAvailableChanged') {
      const enabled = !!m.enabled;
      document.querySelectorAll('button[data-ai]').forEach((b) => {
        if (enabled) { b.classList.remove('disabled'); b.removeAttribute('disabled'); }
        else { b.classList.add('disabled'); b.setAttribute('disabled', 'disabled'); }
        // re-bind if newly enabled
        if (enabled && !b._bound) {
          b._bound = true;
          b.addEventListener('click', () => {
            const idx = b.getAttribute('data-case-index');
            const args = idx ? { ...ref, caseIndex: Number(idx) } : ref;
            vscode.postMessage({ type: 'ai', kind: b.getAttribute('data-ai'), args });
          });
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
  const aiClass = aiEnabled ? 'btn-ghost ai-btn' : 'btn-ghost ai-btn disabled';
  const aiDisabled = aiEnabled ? '' : 'disabled';
  const openClass = isFail ? 'open' : '';

  const inputSection = `
    <div class="io-block">
      <div class="io-label">输入</div>
      <pre>${escapeHtml(extractInput(c)) || '<em style="opacity:0.4">（无）</em>'}</pre>
    </div>`;

  const expectedSection = c.expected !== undefined ? `
    <div class="io-block">
      <div class="io-label">期望输出</div>
      <pre>${escapeHtml(c.expected)}</pre>
    </div>` : '';

  const actualSection = `
    <div class="io-block">
      <div class="io-label">实际输出</div>
      <pre>${escapeHtml(c.stdout)}</pre>
    </div>`;

  const stderrSection = c.stderr ? `
    <div class="io-block">
      <div class="io-label">stderr</div>
      <pre style="color:var(--oj-yellow)">${escapeHtml(c.stderr)}</pre>
    </div>` : '';

  const diffSection = c.diff ? `
    <div class="io-block">
      <div class="io-label">Diff</div>
      <pre>${renderDiff(c.diff.unifiedDiff)}</pre>
    </div>` : '';

  return `
  <div class="case-card verdict-${c.verdict.toLowerCase()} ${openClass}">
    <div class="case-head" data-toggle>
      <span class="verdict-chip ${escapeHtml(c.verdict)}">${escapeHtml(c.verdict)}</span>
      <span class="case-num">用例 #${c.index}</span>
      <span class="case-time">${c.timeMs ?? 0}ms</span>
      <div class="case-actions">
        <button class="btn-ghost" data-cmd="judge.runCase" data-case-index="${c.index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          重跑
        </button>
        ${isFail ? `
        <button class="${aiClass}" data-ai="explainError" data-case-index="${c.index}" ${aiDisabled}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
          AI 解释
        </button>` : ''}
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
    if (line.startsWith('+')) return `<span class="diff-line-add">${escapeHtml(line)}</span>`;
    if (line.startsWith('-')) return `<span class="diff-line-del">${escapeHtml(line)}</span>`;
    return escapeHtml(line);
  }).join('\n');
}

function extractInput(_c: JudgeCaseResult): string {
  return '';
}
