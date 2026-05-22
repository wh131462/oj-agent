import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceMeta } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { problemRefKey } from '../utils/problem-ref.js';
import { renderProblemHtml } from '../webview-content/problem-html.js';
import { renderMarkdown } from '../webview-content/markdown.js';
import { genNonce } from '../utils/html.js';

export interface ProblemWebviewDeps {
  extensionUri: vscode.Uri;
  /** AI 是否可用(有 active profile)。 */
  isAIEnabled: () => boolean;
  /** 题目工作区目录解析:从 ref 找到 <root>/<platform>/<id>-<slug>-<date>/。 */
  resolveProblemDir: (ref: ProblemRef) => Promise<string | undefined>;
  /** 命令路由:webview 发回的 { type:'cmd', cmd, args } 透传给 'ojAgent.' + cmd 。 */
  onCommand: (cmd: string, args: unknown) => void;
  /** AI 入口:四个已有命令的统一入口。 */
  onAIAction: (kind: 'explainError' | 'generateApproach' | 'generateSolution' | 'explainCode', ref: ProblemRef) => void;
}

interface PanelEntry {
  panel: vscode.WebviewPanel;
  ref: ProblemRef;
}

export class ProblemWebviewManager {
  private readonly panels = new Map<string, PanelEntry>();

  constructor(private readonly deps: ProblemWebviewDeps) {}

  /** 打开或复用 webview;成功返回 panel。 */
  async open(ref: ProblemRef): Promise<vscode.WebviewPanel> {
    const key = problemRefKey(ref);
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      await this.refresh(ref);
      return existing.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      'ojAgent.problemView',
      `${ref.platform} ${ref.id}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.deps.extensionUri, 'resources'),
        ],
      },
    );
    panel.onDidDispose(() => this.panels.delete(key));
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(ref, msg));
    this.panels.set(key, { panel, ref });
    await this.renderInto(panel, ref);
    return panel;
  }

  async refresh(ref: ProblemRef): Promise<void> {
    const entry = this.panels.get(problemRefKey(ref));
    if (!entry) return;
    await this.renderInto(entry.panel, ref);
  }

  /** AI 状态变化时通知所有 panel。 */
  postAIAvailableChanged(enabled: boolean): void {
    for (const { panel } of this.panels.values()) {
      void panel.webview.postMessage({ type: 'aiAvailableChanged', enabled });
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

  private async renderInto(panel: vscode.WebviewPanel, ref: ProblemRef): Promise<void> {
    let meta: WorkspaceMeta | undefined;
    let markdownSrc = '';
    try {
      const dir = await this.deps.resolveProblemDir(ref);
      if (dir) {
        try {
          const metaRaw = await fs.readFile(path.join(dir, 'meta.json'), 'utf-8');
          meta = JSON.parse(metaRaw) as WorkspaceMeta;
        } catch {
          /* ignore */
        }
        try {
          markdownSrc = await fs.readFile(path.join(dir, 'problem.md'), 'utf-8');
        } catch {
          markdownSrc = '(尚未拉取本地题面,请先点击工具栏 · 刷新)';
        }
      } else {
        markdownSrc = '(题目尚未拉取到工作区)';
      }
    } catch (e) {
      markdownSrc = `(读取题面失败: ${e instanceof Error ? e.message : String(e)})`;
    }
    const bodyHtml = await renderMarkdown(markdownSrc);
    const html = renderProblemHtml({
      problemRef: ref,
      meta,
      bodyHtml,
      webview: panel.webview,
      extensionUri: this.deps.extensionUri,
      aiEnabled: this.deps.isAIEnabled(),
      nonce: genNonce(),
    });
    panel.webview.html = html;
  }

  private onMessage(ref: ProblemRef, msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { type?: string; cmd?: string; kind?: string; args?: unknown };
    if (m.type === 'cmd' && typeof m.cmd === 'string') {
      this.deps.onCommand(m.cmd, m.args ?? ref);
      return;
    }
    if (m.type === 'ai' && typeof m.kind === 'string') {
      const valid: Array<'explainError' | 'generateApproach' | 'generateSolution' | 'explainCode'> = [
        'explainError',
        'generateApproach',
        'generateSolution',
        'explainCode',
      ];
      if (valid.includes(m.kind as typeof valid[number])) {
        this.deps.onAIAction(m.kind as typeof valid[number], ref);
      }
    }
  }
}
