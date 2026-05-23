import * as vscode from 'vscode';
import type { AIContextInput, AIAction, JudgeLang } from '@oj-agent/core';
import { buildAIServices } from './extension/services.js';
import { registerCommands } from './extension/commands.js';
import { updateStatusBar } from './extension/status-bar.js';
import { AIPanel } from './extension/ai-panel.js';

import { buildOJServices, resolveWorkspaceRoot } from './extension/oj-services.js';
import { ProblemTreeDataProvider } from './extension/views/problem-tree.js';
import { ProblemWebviewManager } from './extension/views/problem-webview.js';
import { JudgePanelManager } from './extension/views/judge-panel.js';
import { StatusBarManager } from './extension/views/status-bar.js';
import { registerProblemTreeCommands } from './extension/commands/problems.js';
import { registerPlatformCommands } from './extension/commands/platform.js';
import { registerJudgeCommands, inferLangFromDir } from './extension/commands/judge.js';
import { registerSubmissionCommands } from './extension/commands/submission.js';
import { registerAuthCommands } from './extension/commands/auth.js';
import { registerStatusBarCommands } from './extension/commands/status-bar.js';
import { ProblemContextProvider } from './extension/context-providers/problem.js';
import { TestCaseContextProvider } from './extension/context-providers/test-case.js';
import { DebugWebviewPanel } from './extension/views/debug-webview-panel.js';
import { findProblemDir } from './extension/utils/workspace-resolver.js';
import type { ProblemRef } from './extension/utils/problem-ref.js';

export function activate(ctx: vscode.ExtensionContext): void {
  // ---- 既有 AI 链 ----
  const aiServices = buildAIServices(ctx);
  const aiStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  ctx.subscriptions.push(aiStatusBar);
  updateStatusBar(aiStatusBar, aiServices);

  // ---- M1 OJ 链 ----
  const oj = buildOJServices(ctx);

  // 注册 AI 相关命令(SettingsPanel 需要 oj 中的 credentialStore/configBackend)
  for (const d of registerCommands(ctx, aiServices, { profilesView: { refresh: () => { /* noop: sidebar AI view removed */ } } }, oj)) {
    ctx.subscriptions.push(d);
  }

  // Debug 日志面板：仅 dev 模式注册命令
  const isDev = ctx.extensionMode === vscode.ExtensionMode.Development;
  if (isDev) {
    ctx.subscriptions.push(
      vscode.commands.registerCommand('ojAgent.openDebugPanel', () => {
        DebugWebviewPanel.show(oj.debugLogs);
      }),
    );
  }

  // AI 启用判断
  const isAIEnabled = (): boolean => !!aiServices.profiles.getActive();

  // 最近一次提交的 ref(用于 submission.openLatest)
  let latestSubmittedRef: ProblemRef | undefined;

  // context providers
  const problemCtxProvider = new ProblemContextProvider(
    () => resolveWorkspaceRoot(oj.configBackend),
    () => (oj.configBackend.get<'cpp' | 'python3' | 'java' | 'javascript'>('ui.defaultLang') ?? 'cpp'),
  );
  const testCaseCtxProvider = new TestCaseContextProvider();

  // AI 入口路由:把题面/judge panel 的按钮拼装上下文,丢给已有 AIPanel.showWith
  const invokeAI = async (kind: AIAction['kind'], ref: ProblemRef, caseIndex?: number): Promise<void> => {
    if (!isAIEnabled()) {
      void vscode.window
        .showWarningMessage('请先在 OJ-Agent 设置中配置并激活 AI Profile', '打开 AI 设置')
        .then((p) => {
          if (p) void vscode.commands.executeCommand('ojAgent.ai.openSettings');
        });
      return;
    }
    const ctxRes = await problemCtxProvider.get(ref);
    if (!ctxRes) {
      void vscode.window.showWarningMessage('题目尚未拉取到本地,无法构造 AI 上下文');
      return;
    }
    const input: AIContextInput = {
      action: { kind },
      problem: ctxRes.problem,
      code: ctxRes.code,
    };
    if (kind === 'explainError') {
      const failed = await testCaseCtxProvider.get(ref, caseIndex);
      if (failed) input.failedCase = failed;
    }
    AIPanel.showWith(ctx, aiServices, input);
  };

  // ---- views ----
  const problemTree = new ProblemTreeDataProvider(ctx, oj.registry, oj.credentialChecker, oj.configBackend);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('ojAgent.problems', problemTree),
  );

  const problemWebview = new ProblemWebviewManager({
    extensionUri: ctx.extensionUri,
    isAIEnabled,
    resolveProblemDir: async (ref) => findProblemDir(resolveWorkspaceRoot(oj.configBackend), ref),
    resolveCurrentLang: async (ref) => {
      const dir = await findProblemDir(resolveWorkspaceRoot(oj.configBackend), ref);
      const fallback = (oj.configBackend.get<JudgeLang>('ui.defaultLang') ?? 'cpp');
      if (!dir) return fallback;
      return inferLangFromDir(dir, fallback);
    },
    onLanguageChange: async (ref, lang) => {
      const dir = await findProblemDir(resolveWorkspaceRoot(oj.configBackend), ref);
      if (!dir) {
        void vscode.window.showWarningMessage('题目目录未找到，请先拉取题目');
        return;
      }
      await ensureSolutionFile(dir, lang);
      const target = solutionFilenameForLang(lang);
      const filePath = (await import('node:path')).join(dir, target);
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    },
    onCommand: (cmd, args) => {
      const id = cmd === 'platform.openCode'
        ? '' // 内部处理,见下
        : `ojAgent.${cmd}`;
      if (cmd === 'platform.openCode') {
        void openSolutionFile(oj, args as ProblemRef);
        return;
      }
      void vscode.commands.executeCommand(id, args);
    },
    onAIAction: (kind, ref) => {
      void invokeAI(kind, ref);
    },
  });
  ctx.subscriptions.push({ dispose: () => problemWebview.dispose() });

  const judgePanel = new JudgePanelManager({
    isAIEnabled,
    onCommand: (cmd, args) => {
      void vscode.commands.executeCommand(`ojAgent.${cmd}`, args);
    },
    onAIAction: (kind, ref, caseIndex) => {
      void invokeAI(kind, ref, caseIndex);
    },
  });
  ctx.subscriptions.push({ dispose: () => judgePanel.dispose() });

  const statusBar = new StatusBarManager(oj.configBackend);
  ctx.subscriptions.push({ dispose: () => statusBar.dispose() });
  ctx.subscriptions.push(statusBar.attachCredential(oj.credentialStore));

  // 凭证变化时刷新 TreeView
  ctx.subscriptions.push(oj.credentialStore.onChange(() => problemTree.refresh()));

  // 配置变化:platforms.enabled / ai.activeProfileId
  ctx.subscriptions.push(
    oj.configBackend.onChange('platforms.enabled', () => {
      problemTree.refresh();
      statusBar.updateVisibility();
    }),
    oj.configBackend.onChange('ai.activeProfileId', () => {
      const enabled = isAIEnabled();
      problemWebview.postAIAvailableChanged(enabled);
      judgePanel.postAIAvailableChanged(enabled);
    }),
  );

  // ---- 命令注册 ----
  for (const d of registerProblemTreeCommands(oj, problemTree)) ctx.subscriptions.push(d);
  for (const d of registerPlatformCommands({ services: oj, problemWebview })) ctx.subscriptions.push(d);
  for (const d of registerJudgeCommands({
    services: oj,
    panel: judgePanel,
    recordResult: (ref, res) => {
      void (async () => {
        const dir = await findProblemDir(resolveWorkspaceRoot(oj.configBackend), ref);
        testCaseCtxProvider.record(ref, res, dir);
      })();
    },
  })) ctx.subscriptions.push(d);
  for (const d of registerSubmissionCommands({
    services: oj,
    statusBar,
    judgePanel,
    rememberLatest: (ref) => {
      latestSubmittedRef = ref;
    },
    getLatest: () => latestSubmittedRef,
  })) ctx.subscriptions.push(d);
  for (const d of registerAuthCommands(oj)) ctx.subscriptions.push(d);
  for (const d of registerStatusBarCommands()) ctx.subscriptions.push(d);

  // ---- 既有 AI 配置变化保留 ----
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ojAgent.ai')) {
        updateStatusBar(aiStatusBar, aiServices);
        AIPanel.refreshState(aiServices);
      }
    }),
  );
}

async function openSolutionFile(
  oj: ReturnType<typeof buildOJServices>,
  ref: ProblemRef,
): Promise<void> {
  const root = resolveWorkspaceRoot(oj.configBackend);
  const dir = await findProblemDir(root, ref);
  if (!dir) {
    void vscode.window.showWarningMessage('题目目录未找到');
    return;
  }
  // 找最常见的 solution.* 或 Main.java
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const target = files.find((f) => f === 'Main.java' || /^solution\.[a-z]+$/i.test(f));
  if (!target) {
    void vscode.window.showWarningMessage('未找到 solution.* 或 Main.java');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(path.join(dir, target));
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
}

function solutionFilenameForLang(lang: JudgeLang): string {
  switch (lang) {
    case 'cpp': return 'solution.cpp';
    case 'python3': return 'solution.py';
    case 'java': return 'Main.java';
    case 'javascript': return 'solution.js';
  }
}

function solutionTemplateForLang(lang: JudgeLang): string {
  switch (lang) {
    case 'cpp':
      return '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n';
    case 'python3':
      return 'def main() -> None:\n    pass\n\n\nif __name__ == "__main__":\n    main()\n';
    case 'java':
      return 'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        \n    }\n}\n';
    case 'javascript':
      return '"use strict";\n\nfunction main() {\n    \n}\n\nmain();\n';
  }
}

async function ensureSolutionFile(dir: string, lang: JudgeLang): Promise<void> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const target = solutionFilenameForLang(lang);
  const filePath = path.join(dir, target);
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, solutionTemplateForLang(lang), 'utf-8');
  }
}

export function deactivate(): void {
  /* noop */
}
