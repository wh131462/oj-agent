/**
 * 独立的 Debug 日志面板（WebviewPanel 形式，仅 dev 模式注册）
 * 订阅 DebugLogStore 接收实时日志
 */

import * as vscode from 'vscode';
import type { DebugLogStore } from './debug-panel.js';

export class DebugWebviewPanel {
  private static current?: DebugWebviewPanel;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private unsubscribe: (() => void) | null = null;

  private constructor(private readonly store: DebugLogStore) {
    this.panel = vscode.window.createWebviewPanel(
      'ojAgent.debugPanel',
      'OJ-Agent · Debug 日志',
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.buildHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg: { type: string }) => {
      if (msg.type === 'clear') {
        this.store.clear();
        this.panel.webview.postMessage({ type: 'clear' });
      }
    }, null, this.disposables);

    for (const e of this.store.getHistory()) {
      void this.panel.webview.postMessage({ type: 'log', entry: e });
    }
    this.unsubscribe = this.store.subscribe((entry) => {
      void this.panel.webview.postMessage({ type: 'log', entry });
    });
  }

  static show(store: DebugLogStore): DebugWebviewPanel {
    if (DebugWebviewPanel.current) {
      DebugWebviewPanel.current.panel.reveal(vscode.ViewColumn.Two);
      return DebugWebviewPanel.current;
    }
    DebugWebviewPanel.current = new DebugWebviewPanel(store);
    return DebugWebviewPanel.current;
  }

  private dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    DebugWebviewPanel.current = undefined;
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --term-bg: #0a0e14;
    --term-surface: #151a21;
    --term-border: #1f2937;
    --term-text: #e0e6ed;
    --term-text-dim: #6b7280;
    --term-green: #00ff88;
    --term-cyan: #00d9ff;
    --term-yellow: #ffcc00;
    --term-red: #ff3366;
    --term-purple: #cc66ff;
    --term-mono: 'JetBrains Mono', 'Fira Code', var(--vscode-editor-font-family), monospace;
  }
  body {
    font-family: var(--term-mono);
    font-size: var(--vscode-editor-font-size, 11px);
    background: var(--vscode-editor-background, var(--term-bg));
    color: var(--vscode-editor-foreground, var(--term-text));
    display: flex; flex-direction: column; height: 100vh;
    letter-spacing: 0.01em;
  }
  #toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    background: var(--vscode-sideBarSectionHeader-background, var(--term-surface));
    border-bottom: 1px solid var(--vscode-panel-border, var(--term-border));
    flex-shrink: 0;
  }
  #toolbar button {
    background: transparent;
    color: var(--term-text-dim);
    border: 1px solid var(--term-border);
    padding: 3px 10px;
    cursor: pointer;
    font-size: 10px;
    border-radius: 2px;
    font-family: var(--term-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 700;
    transition: all 0.1s;
  }
  #toolbar button:hover {
    background: rgba(0,255,136,0.1);
    border-color: rgba(0,255,136,0.4);
    color: var(--term-green);
  }
  #filter {
    flex: 1;
    background: var(--vscode-input-background, rgba(0,0,0,0.2));
    color: var(--vscode-input-foreground, var(--term-text));
    border: 1px solid var(--vscode-input-border, var(--term-border));
    padding: 3px 8px;
    font-size: 10px;
    font-family: var(--term-mono);
    border-radius: 2px;
    outline: none;
    transition: border-color 0.1s;
  }
  #filter:focus {
    border-color: rgba(0,255,136,0.4);
    box-shadow: 0 0 0 1px rgba(0,255,136,0.2);
  }
  #count {
    font-size: 9px;
    color: var(--term-text-dim);
    font-family: var(--term-mono);
    opacity: 0.6;
  }
  #autoscroll {
    font-size: 9px;
    accent-color: var(--term-green);
    margin-right: 4px;
  }
  label {
    font-size: 9px;
    color: var(--term-text-dim);
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  #log {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .entry {
    display: flex;
    gap: 6px;
    padding: 3px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    line-height: 1.5;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.08s;
  }
  .entry:hover { background: rgba(0,255,136,0.05); }
  .entry.info .level { color: var(--term-cyan); }
  .entry.warn .level { color: var(--term-yellow); }
  .entry.error .level { color: var(--term-red); }
  .ts {
    color: var(--term-text-dim);
    flex-shrink: 0;
    opacity: 0.5;
    font-size: 10px;
  }
  .level {
    flex-shrink: 0;
    width: 40px;
    text-align: center;
    font-weight: 700;
    font-size: 9px;
    letter-spacing: 0.06em;
  }
  .scope {
    color: var(--term-green);
    flex-shrink: 0;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }
  .msg {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .extra {
    color: var(--term-purple);
    flex-shrink: 0;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    opacity: 0.7;
  }
  .entry.expanded .msg,
  .entry.expanded .extra {
    white-space: pre-wrap;
    word-break: break-all;
    overflow: visible;
  }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="clearLogs()">[ CLR ]</button>
  <input id="filter" type="text" placeholder="filter: scope / message..." oninput="applyFilter()">
  <label><input type="checkbox" id="autoscroll" checked> follow</label>
  <span id="count">0</span>
</div>
<div id="log"></div>
<script>
  const vscode = acquireVsCodeApi();
  let total = 0;
  let filterText = '';

  function clearLogs() {
    document.getElementById('log').innerHTML = '';
    total = 0;
    document.getElementById('count').textContent = '0';
    vscode.postMessage({ type: 'clear' });
  }

  function applyFilter() {
    filterText = document.getElementById('filter').value.toLowerCase();
    for (const el of document.querySelectorAll('.entry')) {
      const text = el.dataset.text || '';
      el.classList.toggle('hidden', filterText.length > 0 && !text.includes(filterText));
    }
  }

  function addEntry(e) {
    total++;
    document.getElementById('count').textContent = total;

    const div = document.createElement('div');
    div.className = 'entry ' + e.level;
    const searchText = (e.scope + ' ' + e.message + ' ' + (e.extra || '')).toLowerCase();
    div.dataset.text = searchText;

    div.innerHTML =
      '<span class="ts">' + esc(e.timestamp) + '</span>' +
      '<span class="level">' + e.level.toUpperCase() + '</span>' +
      '<span class="scope" title="' + esc(e.scope) + '">' + esc(e.scope) + '</span>' +
      '<span class="msg">' + esc(e.message) + '</span>' +
      (e.extra ? '<span class="extra" title="' + esc(e.extra) + '">' + esc(e.extra) + '</span>' : '');

    div.addEventListener('click', () => div.classList.toggle('expanded'));

    if (filterText && !searchText.includes(filterText)) div.classList.add('hidden');

    document.getElementById('log').appendChild(div);

    if (document.getElementById('autoscroll').checked) {
      div.scrollIntoView({ block: 'end' });
    }
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.type === 'log') addEntry(msg.entry);
    if (msg.type === 'clear') {
      document.getElementById('log').innerHTML = '';
      total = 0;
      document.getElementById('count').textContent = '0';
    }
  });
</script>
</body>
</html>`;
  }
}
