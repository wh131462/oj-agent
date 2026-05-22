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

  const platformLabel = problemRef.platform === 'leetcode-cn' ? 'LeetCode CN' : 'HDOJ';

  let body = '';
  if (running) {
    body = `<div class="state running"><span class="spinner"></span> 正在运行本地测试...</div>`;
  } else if (!result) {
    body = `<div class="state empty">尚未运行测试</div>`;
  } else if (result.compileError) {
    body = `<div class="state error"><strong>编译错误</strong><pre>${escapeHtml(result.compileError)}</pre></div>`;
  } else {
    const total = result.cases.length;
    const acCount = result.cases.filter((c) => c.verdict === 'AC').length;
    const totalTime = result.cases.reduce((sum, c) => sum + (c.timeMs ?? 0), 0);
    const allAC = acCount === total && total > 0;
    body = `
      <div class="summary ${allAC ? 'ok' : 'fail'}">
        <strong>${acCount} / ${total} AC</strong> · 总耗时 ${totalTime}ms
        <button class="action" data-cmd="judge.runAll">重跑全部</button>
      </div>
      <div class="cases">
        ${result.cases.map((c) => renderCase(c, problemRef, aiEnabled)).join('\n')}
      </div>
    `;
  }

  return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px; max-width: 980px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 12px; }
  h2 { margin: 0; font-size: 16px; }
  .badge { font-size: 11px; padding: 2px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .summary { display: flex; align-items: center; gap: 10px; padding: 8px 10px; margin-bottom: 12px; border-radius: 4px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
  .summary.ok { border-left: 4px solid #198754; }
  .summary.fail { border-left: 4px solid #dc3545; }
  .state { padding: 14px; text-align: center; opacity: 0.85; }
  .state.error { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); text-align: left; }
  .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--vscode-foreground); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .case { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; margin: 8px 0; }
  .case-head { display: flex; align-items: center; gap: 8px; }
  .verdict { font-weight: 600; padding: 2px 8px; border-radius: 3px; font-size: 11px; }
  .verdict.AC { background: #198754; color: white; }
  .verdict.WA, .verdict.TLE, .verdict.RE, .verdict.CE { background: #dc3545; color: white; }
  .case-actions { margin-left: auto; display: flex; gap: 4px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 3px 8px; cursor: pointer; font-size: 11px; }
  button.action { margin-left: auto; }
  button.ai { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.disabled { opacity: 0.45; cursor: not-allowed; }
  details { margin-top: 6px; }
  summary { cursor: pointer; opacity: 0.8; font-size: 12px; }
  pre { background: var(--vscode-textCodeBlock-background); padding: 8px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 12px; }
</style></head><body>
<header>
  <h2>本地测试 · ${escapeHtml(platformLabel)} ${escapeHtml(problemRef.id)}</h2>
  <span class="badge">${escapeHtml(problemRef.slug ?? '')}</span>
</header>
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
</script></body></html>`;
}

function renderCase(c: JudgeCaseResult, _ref: ProblemRef, aiEnabled: boolean): string {
  const isFail = c.verdict !== 'AC';
  const aiAttr = aiEnabled ? '' : 'disabled';
  const aiCls = aiEnabled ? 'ai' : 'ai disabled';
  return `
    <div class="case">
      <div class="case-head">
        <span class="verdict ${escapeHtml(c.verdict)}">${escapeHtml(c.verdict)}</span>
        <span>用例 #${c.index}</span>
        <span>·</span>
        <span>${c.timeMs}ms</span>
        <div class="case-actions">
          <button data-cmd="judge.runCase" data-case-index="${c.index}">重跑此用例</button>
          ${isFail ? `<button class="${aiCls}" data-ai="explainError" data-case-index="${c.index}" ${aiAttr}>AI · 解释错因</button>` : ''}
        </div>
      </div>
      <details ${isFail ? 'open' : ''}>
        <summary>输入 / 期望 / 实际</summary>
        <div><strong>输入:</strong><pre>${escapeHtml(c.expected !== undefined ? '' : '')}${escapeHtml(extractInput(c))}</pre></div>
        ${c.expected !== undefined ? `<div><strong>期望:</strong><pre>${escapeHtml(c.expected)}</pre></div>` : ''}
        <div><strong>实际:</strong><pre>${escapeHtml(c.stdout)}</pre></div>
        ${c.stderr ? `<div><strong>stderr:</strong><pre>${escapeHtml(c.stderr)}</pre></div>` : ''}
        ${c.diff ? `<div><strong>diff:</strong><pre>${escapeHtml(c.diff.unifiedDiff)}</pre></div>` : ''}
      </details>
    </div>
  `;
}

// JudgeCaseResult 没有显式 input,留空给将来扩展;当前直接显示 stdout/expected/diff。
function extractInput(_c: JudgeCaseResult): string {
  return '';
}
