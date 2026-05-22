import * as vscode from 'vscode';
import type { JudgeRunResult } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { problemRefKey } from '../utils/problem-ref.js';
import { renderJudgeHtml } from '../webview-content/judge-html.js';
import { genNonce } from '../utils/html.js';

export interface JudgePanelDeps {
  isAIEnabled: () => boolean;
  onCommand: (cmd: string, args: unknown) => void;
  onAIAction: (
    kind: 'explainError' | 'generateApproach' | 'generateSolution' | 'explainCode',
    ref: ProblemRef,
    caseIndex?: number,
  ) => void;
}

interface Entry {
  panel: vscode.WebviewPanel;
  ref: ProblemRef;
  lastResult?: JudgeRunResult;
}

export class JudgePanelManager {
  private readonly panels = new Map<string, Entry>();

  constructor(private readonly deps: JudgePanelDeps) {}

  /** 返回最近一次结果(供 submission/AI 等模块读取)。 */
  getLastResult(ref: ProblemRef): JudgeRunResult | undefined {
    return this.panels.get(problemRefKey(ref))?.lastResult;
  }

  show(ref: ProblemRef): vscode.WebviewPanel {
    const key = problemRefKey(ref);
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      this.render(existing);
      return existing.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      'ojAgent.judgeResult',
      `测试: ${ref.platform} ${ref.id}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const entry: Entry = { panel, ref };
    this.panels.set(key, entry);
    panel.onDidDispose(() => this.panels.delete(key));
    panel.webview.onDidReceiveMessage((m) => this.onMessage(entry, m));
    this.render(entry);
    return panel;
  }

  setRunning(ref: ProblemRef): void {
    const e = this.panels.get(problemRefKey(ref));
    if (!e) return;
    e.lastResult = undefined;
    this.render(e, true);
  }

  update(ref: ProblemRef, result: JudgeRunResult): void {
    const e = this.panels.get(problemRefKey(ref));
    if (!e) return;
    e.lastResult = result;
    this.render(e);
  }

  postAIAvailableChanged(enabled: boolean): void {
    for (const e of this.panels.values()) {
      // 简单粗暴:整体重渲染。AI disable 状态作用在按钮 class,只能重渲染。
      void e.panel.webview.postMessage({ type: 'aiAvailableChanged', enabled });
      this.render(e);
    }
  }

  dispose(): void {
    for (const { panel } of this.panels.values()) {
      try {
        panel.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panels.clear();
  }

  private render(entry: Entry, running = false): void {
    const html = renderJudgeHtml({
      result: entry.lastResult,
      running,
      problemRef: entry.ref,
      aiEnabled: this.deps.isAIEnabled(),
      webview: entry.panel.webview,
      nonce: genNonce(),
    });
    entry.panel.webview.html = html;
  }

  private onMessage(entry: Entry, msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { type?: string; cmd?: string; kind?: string; args?: { caseIndex?: number } };
    if (m.type === 'cmd' && typeof m.cmd === 'string') {
      this.deps.onCommand(m.cmd, m.args ?? entry.ref);
      return;
    }
    if (m.type === 'ai' && typeof m.kind === 'string') {
      const valid = ['explainError', 'generateApproach', 'generateSolution', 'explainCode'] as const;
      if (valid.includes(m.kind as typeof valid[number])) {
        const caseIdx = m.args && typeof m.args.caseIndex === 'number' ? m.args.caseIndex : undefined;
        this.deps.onAIAction(m.kind as typeof valid[number], entry.ref, caseIdx);
      }
    }
  }
}
