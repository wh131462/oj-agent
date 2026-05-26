import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  JudgeLang,
  PlatformJudgeResult,
  PlatformVerdict,
  SubmissionProgress,
} from '@oj-agent/core';
import { AdapterError } from '@oj-agent/core';
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

function formatVerdictDetail(result: PlatformJudgeResult): string {
  const parts: string[] = [result.verdict];
  if (result.timeMs !== undefined) parts.push(`${result.timeMs}ms`);
  if (result.memoryKb !== undefined) parts.push(`${result.memoryKb}KB`);
  if (result.passedCases !== undefined) {
    parts.push(`${result.passedCases}/${result.totalCases ?? '?'}`);
  }
  return parts.join(' · ');
}

export function registerSubmissionCommands(deps: SubmissionCommandDeps): vscode.Disposable[] {
  const { services, statusBar, rememberLatest, getLatest, judgePanel } = deps;
  const logger = services.logger;
  const loggerBackend = services.loggerBackend;

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
      // 非模态轻量确认:不打断鼠标焦点,但仍要显式点击
      const ok = await vscode.window.showInformationMessage(
        `提交到 ${ref.platform} ${ref.id} (lang=${lang}, ${code.length} 字节)?`,
        '提交',
        '取消',
      );
      if (ok !== '提交') return;
    }

    const minIntervalMs = services.configBackend.get<number>('submission.minIntervalMs') ?? 5000;
    const pollTimeoutMs = services.configBackend.get<number>('submission.pollTimeoutMs') ?? 60_000;

    rememberLatest(ref);
    const abortController = new AbortController();

    // 用 withProgress 包住整个提交,提供取消按钮与实时计时
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `提交 ${ref.platform} ${ref.id}`,
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => abortController.abort());

        // judging 阶段计时器:每秒刷新一次 message
        let judgingStartedAt: number | undefined;
        let tickTimer: ReturnType<typeof setInterval> | undefined;
        const startTicker = () => {
          judgingStartedAt = Date.now();
          tickTimer = setInterval(() => {
            const sec = Math.floor((Date.now() - (judgingStartedAt ?? Date.now())) / 1000);
            progress.report({ message: `评测中 · 已 ${sec}s` });
          }, 1000);
        };
        const stopTicker = () => {
          if (tickTimer) clearInterval(tickTimer);
          tickTimer = undefined;
        };

        statusBar.setSubmitting();
        progress.report({ message: '准备中…' });

        try {
          const result = await services.submissionRunner.run({
            platform: ref!.platform,
            problemId: ref!.id,
            lang,
            code,
            minIntervalMs,
            pollTimeoutMs,
            signal: abortController.signal,
            onProgress: (s: SubmissionProgress) => {
              if (s.stage === 'pre-check') {
                progress.report({ message: '检查登录…' });
              } else if (s.stage === 'submitting') {
                statusBar.setSubmitting();
                progress.report({ message: '提交中…' });
              } else if (s.stage === 'judging') {
                statusBar.setJudging();
                startTicker();
              }
            },
          });
          stopTicker();

          const verdict: PlatformVerdict = result.verdict;
          statusBar.setVerdict(verdict, result.timeMs);
          const detail = formatVerdictDetail(result);
          loggerBackend.info('submission', 'result', {
            platform: ref!.platform,
            id: ref!.id,
            lang,
            ...result,
          });

          // 同步给 judgePanel 一下最近提交记录(若已打开则刷新提示;未打开不主动 show)
          void judgePanel;

          if (verdict === 'AC') {
            void vscode.window.showInformationMessage(
              `✅ ${ref!.platform} ${ref!.id}: ${detail}`,
              '查看日志',
            ).then((pick) => {
              if (pick === '查看日志') logger.show();
            });
          } else {
            const msg = `❌ ${ref!.platform} ${ref!.id}: ${detail}`;
            const buttons: string[] = ['查看日志'];
            if (result.compileError) buttons.unshift('查看编译错误');
            const pick = await vscode.window.showWarningMessage(msg, ...buttons);
            if (pick === '查看编译错误' && result.compileError) {
              const doc = await vscode.workspace.openTextDocument({
                content: result.compileError,
                language: 'plaintext',
              });
              await vscode.window.showTextDocument(doc, { preview: true });
            } else if (pick === '查看日志') {
              logger.show();
            }
          }
        } catch (e) {
          stopTicker();
          statusBar.setVerdict('UNKNOWN');
          await handleSubmitError(e, ref!);
        }
      },
    );
  }

  async function handleSubmitError(e: unknown, ref: ProblemRef): Promise<void> {
    const isAbort = e instanceof AdapterError && e.code === 'NETWORK_ERROR' && /aborted/i.test(e.message);
    if (isAbort) {
      void vscode.window.showInformationMessage('已取消提交');
      return;
    }

    loggerBackend.error('submission', 'submit failed', e);

    if (e instanceof AdapterError) {
      switch (e.code) {
        case 'AUTH_REQUIRED':
        case 'AUTH_EXPIRED': {
          const pick = await vscode.window.showErrorMessage(
            `提交失败: ${e.message}`,
            '去登录',
          );
          if (pick === '去登录') {
            await vscode.commands.executeCommand('ojAgent.auth.login', ref.platform);
          }
          return;
        }
        case 'RATE_LIMITED': {
          void vscode.window.showWarningMessage(`提交过于频繁: ${e.message}`);
          return;
        }
        case 'JUDGING_TIMEOUT': {
          const pick = await vscode.window.showWarningMessage(
            `评测超时: ${e.message}`,
            '查看日志',
          );
          if (pick === '查看日志') logger.show();
          return;
        }
        default: {
          const pick = await vscode.window.showErrorMessage(
            `提交失败 [${e.code}]: ${e.message}`,
            '查看日志',
          );
          if (pick === '查看日志') logger.show();
          return;
        }
      }
    }

    const pick = await vscode.window.showErrorMessage(
      `提交失败: ${e instanceof Error ? e.message : String(e)}`,
      '查看日志',
    );
    if (pick === '查看日志') logger.show();
  }

  return [
    vscode.commands.registerCommand('ojAgent.submission.submit', (arg?: ProblemRef & { _preferLang?: JudgeLang }) => submit(arg)),

    vscode.commands.registerCommand('ojAgent.submission.openLatest', () => {
      const ref = getLatest();
      if (!ref) {
        void vscode.window.showInformationMessage('尚无提交记录');
        return;
      }
      deps.judgePanel.show(ref);
    }),
  ];
}
