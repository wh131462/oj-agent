import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  JudgeLang,
  PlatformVerdict,
  SubmissionProgress,
} from '@oj-agent/core';
import type { OJServices } from '../oj-services.js';
import { resolveWorkspaceRoot } from '../oj-services.js';
import type { ProblemRef } from '../utils/problem-ref.js';
import { findProblemDir, inferRefFromDir } from '../utils/workspace-resolver.js';
import { inferLangFromDir } from './judge.js';
import type { StatusBarManager } from '../views/status-bar.js';
import type { JudgePanelManager } from '../views/judge-panel.js';

export interface SubmissionCommandDeps {
  services: OJServices;
  statusBar: StatusBarManager;
  judgePanel: JudgePanelManager;
  rememberLatest: (ref: ProblemRef) => void;
  getLatest: () => ProblemRef | undefined;
}

async function readSolutionCode(dir: string, lang: JudgeLang): Promise<string | undefined> {
  const candidates: string[] = lang === 'java'
    ? ['Main.java']
    : [`solution.${lang === 'cpp' ? 'cpp' : lang === 'c' ? 'c' : lang === 'python3' ? 'py' : lang === 'javascript' ? 'js' : 'cpp'}`];
  for (const f of candidates) {
    try {
      return await fs.readFile(path.join(dir, f), 'utf-8');
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function registerSubmissionCommands(deps: SubmissionCommandDeps): vscode.Disposable[] {
  const { services, statusBar, judgePanel, rememberLatest, getLatest } = deps;

  async function submit(refArg?: ProblemRef & { _preferLang?: JudgeLang }): Promise<void> {
    let ref = refArg;
    if (!ref) {
      const ed = vscode.window.activeTextEditor;
      if (ed) ref = inferRefFromDir(path.dirname(ed.document.uri.fsPath));
    }
    if (!ref) {
      void vscode.window.showWarningMessage('请在题目目录下激活编辑器,或从题面工具栏点击提交');
      return;
    }
    const root = resolveWorkspaceRoot(services.configBackend);
    const dir = await findProblemDir(root, ref);
    if (!dir) {
      void vscode.window.showWarningMessage('题目目录未找到');
      return;
    }
    const defaultLang = services.configBackend.get<JudgeLang>('ui.defaultLang') ?? 'cpp';
    const lang = await inferLangFromDir(dir, defaultLang, refArg?._preferLang);
    const code = await readSolutionCode(dir, lang);
    if (!code || code.trim().length === 0) {
      void vscode.window.showWarningMessage('题解文件为空,无法提交');
      return;
    }

    const confirmEnabled = services.configBackend.get<boolean>('submission.confirmBeforeSubmit') ?? true;
    if (confirmEnabled) {
      const ok = await vscode.window.showWarningMessage(
        `确认提交到 ${ref.platform} ${ref.id} (lang=${lang}, ${code.length} 字节)?`,
        { modal: true },
        '提交',
      );
      if (ok !== '提交') return;
    }

    const minIntervalMs = services.configBackend.get<number>('submission.minIntervalMs') ?? 5000;
    const pollTimeoutMs = services.configBackend.get<number>('submission.pollTimeoutMs') ?? 60_000;

    statusBar.setSubmitting();
    rememberLatest(ref);

    try {
      const result = await services.submissionRunner.run({
        platform: ref.platform,
        problemId: ref.id,
        lang,
        code,
        minIntervalMs,
        pollTimeoutMs,
        onProgress: (s: SubmissionProgress) => {
          if (s.stage === 'submitting') statusBar.setSubmitting();
          else if (s.stage === 'judging') statusBar.setJudging();
        },
      });
      const verdict: PlatformVerdict = result.verdict;
      statusBar.setVerdict(verdict, result.timeMs);
      const msg = `${verdict}${result.timeMs ? ` · ${result.timeMs}ms` : ''}${result.passedCases !== undefined ? ` · ${result.passedCases}/${result.totalCases ?? '?'}` : ''}`;
      if (verdict === 'AC') {
        void vscode.window.showInformationMessage(`提交结果: ${msg}`);
      } else {
        void vscode.window.showWarningMessage(`提交结果: ${msg}${result.compileError ? '\n' + result.compileError : ''}`);
      }
    } catch (e) {
      statusBar.setVerdict('UNKNOWN');
      void vscode.window.showErrorMessage(`提交失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return [
    vscode.commands.registerCommand('ojAgent.submission.submit', (arg?: ProblemRef & { _preferLang?: JudgeLang }) => submit(arg)),

    vscode.commands.registerCommand('ojAgent.submission.openLatest', () => {
      const ref = getLatest();
      if (!ref) {
        void vscode.window.showInformationMessage('尚无提交记录');
        return;
      }
      judgePanel.show(ref);
    }),
  ];
}
