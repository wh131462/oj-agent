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
import { findProblemDir } from './extension/utils/workspace-resolver.js';
import { pickOpenColumn } from './extension/utils/view-column.js';
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

  // AI 启用判断
  const isAIEnabled = (): boolean => !!aiServices.profiles.getActive();

  // 最近一次提交的 ref(用于 submission.openLatest)
  let latestSubmittedRef: ProblemRef | undefined;

  // context providers
  const problemCtxProvider = new ProblemContextProvider(
    () => resolveWorkspaceRoot(oj.configBackend),
    () => (oj.configBackend.get<JudgeLang>('ui.defaultLang') ?? 'cpp'),
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
  const problemTree = new ProblemTreeDataProvider(ctx, oj.registry, oj.credentialChecker, oj.configBackend, oj.credentialStore);
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
    resolveAvailableLangs: async (ref) => {
      const adapter = oj.registry.get(ref.platform);
      if (!adapter.getProblemLangs) return undefined;
      // 仅返回 webview 当前能展示与处理的 JudgeLang 子集
      const judgeLangs: ReadonlySet<JudgeLang> = new Set(['cpp', 'c', 'python3', 'java', 'javascript']);
      try {
        const langs = await adapter.getProblemLangs(ref.slug ?? ref.id);
        const filtered = langs
          .filter((l): l is typeof l & { lang: JudgeLang } => judgeLangs.has(l.lang as JudgeLang))
          .map((l) => ({ lang: l.lang, displayName: l.displayName }));
        // 平台返回了语言但 0 个在本地 JudgeLang 子集中 → 拼一个解释文案
        if (filtered.length === 0 && langs.length > 0) {
          const rawNames = langs.map((l) => l.displayName || l.lang).join('、');
          return {
            langs: filtered,
            unsupportedReason: `该题平台仅支持 ${rawNames}，本地工具链暂不支持这些语言；请在浏览器中提交。`,
          };
        }
        return { langs: filtered };
      } catch {
        return undefined;
      }
    },
    onLanguageChange: async (ref, lang) => {
      const dir = await findProblemDir(resolveWorkspaceRoot(oj.configBackend), ref);
      if (!dir) {
        void vscode.window.showWarningMessage('题目目录未找到，请先拉取题目');
        return;
      }
      const { solutionPath } = await ensureSolutionFile(oj, dir, lang);
      const doc = await vscode.workspace.openTextDocument(solutionPath);
      await vscode.window.showTextDocument(doc, pickOpenColumn());
      problemTree.refreshLocalFiles();
    },
    onCommand: (cmd, args, lang) => {
      const id = cmd === 'platform.openCode'
        ? '' // 内部处理,见下
        : `ojAgent.${cmd}`;
      if (cmd === 'platform.openCode') {
        void openSolutionFile(oj, args as ProblemRef, lang);
        return;
      }
      // 其他命令（judge.runAll/runCase、submission.submit 等）按"args 上挂 _preferLang"约定透传，
      // handler 自行决定是否消费。约定使用下划线前缀避免与 ProblemRef 公共字段冲突。
      const finalArgs = lang && args && typeof args === 'object'
        ? { ...(args as Record<string, unknown>), _preferLang: lang }
        : args;
      void vscode.commands.executeCommand(id, finalArgs);
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

  // ---- 工作区文件监听:本地题目目录下文件增删/变动时刷新树 ----
  let workspaceWatcher: vscode.Disposable | undefined;
  const installWorkspaceWatcher = (): void => {
    workspaceWatcher?.dispose();
    workspaceWatcher = undefined;
    const root = resolveWorkspaceRoot(oj.configBackend);
    if (!root) return;
    const rootUri = vscode.Uri.file(expandHomeDir(root));
    // 监听 <root>/<platform>/<problemDir>/{solution.*,Main.java,Solution.java,meta.json} 与 cases/*.txt
    const pattern = new vscode.RelativePattern(rootUri, '*/*/{solution.*,Main.java,Solution.java,meta.json,cases/*.txt}');
    const w = vscode.workspace.createFileSystemWatcher(pattern);
    const trigger = debounce(() => problemTree.refreshLocalFiles(), 200);
    workspaceWatcher = vscode.Disposable.from(
      w,
      w.onDidCreate(trigger),
      w.onDidDelete(trigger),
      w.onDidChange(trigger),
    );
    ctx.subscriptions.push(workspaceWatcher);
  };
  installWorkspaceWatcher();
  ctx.subscriptions.push(
    oj.configBackend.onChange('workspace.root', () => installWorkspaceWatcher()),
    { dispose: () => workspaceWatcher?.dispose() },
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
  preferLang?: JudgeLang,
): Promise<void> {
  const root = resolveWorkspaceRoot(oj.configBackend);
  const dir = await findProblemDir(root, ref);
  if (!dir) {
    void vscode.window.showWarningMessage('题目目录未找到');
    return;
  }
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  // 优先：调用方明确指定了 lang（如 webview 顶部菜单当前选中），按其打开对应文件
  let target: string | undefined;
  if (preferLang) {
    const wants = solutionFilenamesForLang(preferLang);
    target = wants.find((w) => files.includes(w));
  }
  // 兜底：扫到任何 solution.* / Solution.java / Main.java
  if (!target) {
    target = files.find(
      (f) => /^solution\.[a-z]+$/i.test(f) || f === 'Main.java' || f === 'Solution.java',
    );
  }
  if (!target) {
    void vscode.window.showWarningMessage('未找到 solution.* / Solution.java / Main.java');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(path.join(dir, target));
  await vscode.window.showTextDocument(doc, pickOpenColumn());
}

/**
 * 给定 lang,返回 solution 可能的文件名(按优先级)。Java 函数题用 Solution.java,
 * 非函数题用 Main.java,我们两个都尝试,谁先存在用谁。
 */
function solutionFilenamesForLang(lang: JudgeLang): string[] {
  switch (lang) {
    case 'cpp': return ['solution.cpp'];
    case 'c': return ['solution.c'];
    case 'python3': return ['solution.py'];
    case 'java': return ['Solution.java', 'Main.java'];
    case 'javascript': return ['solution.js'];
  }
}

/**
 * 切语言时确保对应 solution 文件存在,并按需生成 harness。
 *
 * 与之前裸写本地模板不同:这里走 core 的 writeSolutionAndHarness,
 *   - 读 meta.json 拿 codeSnippets[lang] 与 harnessSpec
 *   - 函数题(leetcode 等) Java -> Solution.java + Harness.java; 其他语言同时生成 harness.<ext>
 *   - 非函数题保持原行为(Main.java / solution.<ext>),不生成 harness
 * 返回真实落地的 solutionPath,调用方据此打开。
 */
async function ensureSolutionFile(
  oj: ReturnType<typeof buildOJServices>,
  dir: string,
  lang: JudgeLang,
): Promise<{ solutionPath: string }> {
  // C 暂不支持 harness 生成,workspace-manager 会跳过 harness,solution 仍按常规落地
  const meta = await oj.workspaceManager.readMeta(dir);
  const snippet = meta?.codeSnippets?.[lang === 'javascript' ? 'javascript' : lang];
  const { solutionPath } = await oj.workspaceManager.writeSolutionAndHarness(dir, {
    lang,
    snippet,
    harnessSpec: meta?.harnessSpec,
    overwriteSolution: false,
  });
  return { solutionPath };
}

function expandHomeDir(p: string): string {
  if (p.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + p.slice(1);
  }
  return p;
}

function debounce(fn: () => void, ms: number): () => void {
  let t: NodeJS.Timeout | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = undefined; fn(); }, ms);
  };
}

export function deactivate(): void {
  /* noop */
}
