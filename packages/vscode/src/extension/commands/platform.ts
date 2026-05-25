import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { JudgeLang, PlatformId } from '@oj-agent/core';
import type { OJServices } from '../oj-services.js';
import { resolveWorkspaceRoot } from '../oj-services.js';
import type { ProblemRef } from '../utils/problem-ref.js';
import { parseProblemUrl } from '../utils/problem-ref.js';
import { findProblemDir, inferRefFromDir } from '../utils/workspace-resolver.js';
import { pickOpenColumn } from '../utils/view-column.js';
import type { ProblemWebviewManager } from '../views/problem-webview.js';
import { inferLangFromDir } from './judge.js';

export interface PlatformCommandDeps {
  services: OJServices;
  problemWebview: ProblemWebviewManager;
}

async function pullAndOpen(deps: PlatformCommandDeps, ref: ProblemRef): Promise<void> {
  const { services, problemWebview } = deps;
  const adapter = services.registry.get(ref.platform);
  const root = resolveWorkspaceRoot(services.configBackend);
  const defaultLang = services.configBackend.get<JudgeLang>('ui.defaultLang') ?? 'cpp';

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `拉取 ${ref.platform} ${ref.id}...` },
    async () => {
      const detail = await adapter.getProblem(ref.slug ?? ref.id);
      // 优先用 adapter.getProblemLangs 获取该题真实支持的语言与初始模板;失败静默回退。
      let problemLangs;
      if (adapter.getProblemLangs) {
        try {
          problemLangs = await adapter.getProblemLangs(ref.slug ?? ref.id);
        } catch {
          // ignore，writeProblem 会回退到 detail.codeSnippets / defaultTemplate
        }
      }
      await services.workspaceManager.writeProblem(detail, { rootDir: root, defaultLang, problemLangs });
    },
  );
  await problemWebview.open(ref);
}

export function registerPlatformCommands(deps: PlatformCommandDeps): vscode.Disposable[] {
  const { services, problemWebview } = deps;

  return [
    vscode.commands.registerCommand('ojAgent.platform.pullByUrl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: '粘贴题目 URL (LeetCode CN / HDOJ)',
        ignoreFocusOut: true,
      });
      if (!url) return;
      const ref = parseProblemUrl(url);
      if (!ref) {
        void vscode.window.showWarningMessage('无法识别该 URL,请确认是 LeetCode CN 或 HDOJ 题目链接');
        return;
      }
      try {
        await pullAndOpen(deps, ref);
      } catch (e) {
        void vscode.window.showErrorMessage(`拉取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),

    vscode.commands.registerCommand('ojAgent.platform.pullProblem', async (arg?: ProblemRef) => {
      if (!arg || !arg.platform || !arg.id) {
        void vscode.window.showWarningMessage('缺少题目信息,请从题库 TreeView 右键调用');
        return;
      }
      try {
        await pullAndOpen(deps, arg);
      } catch (e) {
        void vscode.window.showErrorMessage(`拉取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),

    vscode.commands.registerCommand('ojAgent.platform.openProblemView', async (arg?: ProblemRef) => {
      if (!arg || !arg.platform || !arg.id) {
        void vscode.window.showWarningMessage('缺少题目信息');
        return;
      }
      await problemWebview.open(arg);
    }),

    vscode.commands.registerCommand('ojAgent.platform.openInBrowser', async (arg?: unknown) => {
      const ref = toProblemRef(arg);
      if (!ref) return;
      const url = await buildUrl(ref);
      if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand('ojAgent.platform.refreshProblem', async (arg?: ProblemRef) => {
      if (!arg || !arg.platform || !arg.id) return;
      const root = resolveWorkspaceRoot(services.configBackend);
      const dir = await findProblemDir(root, arg);
      if (!dir) {
        // 没拉过 → 直接拉
        await pullAndOpen(deps, arg);
        return;
      }
      try {
        const detail = await services.registry.get(arg.platform).getProblem(arg.slug ?? arg.id);
        await services.workspaceManager.refresh(detail, dir);
        await problemWebview.refresh(arg);
        void vscode.window.showInformationMessage('题面已刷新');
      } catch (e) {
        void vscode.window.showErrorMessage(`刷新失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),

    vscode.commands.registerCommand('ojAgent.platform.addCustomCase', async (arg?: ProblemRef) => {
      let ref = arg;
      if (!ref) {
        const ed = vscode.window.activeTextEditor;
        if (ed) ref = inferRefFromDir(path.dirname(ed.document.uri.fsPath));
      }
      if (!ref) {
        void vscode.window.showWarningMessage('请先打开题目目录下的文件,或从题库右键调用');
        return;
      }
      const root = resolveWorkspaceRoot(services.configBackend);
      const dir = await findProblemDir(root, ref);
      if (!dir) {
        void vscode.window.showWarningMessage('题目尚未拉取');
        return;
      }
      const input = await vscode.window.showInputBox({ prompt: '自定义用例 · 输入', ignoreFocusOut: true });
      if (input === undefined) return;
      const output = await vscode.window.showInputBox({
        prompt: '自定义用例 · 期望输出(可留空)',
        ignoreFocusOut: true,
      });
      const n = await services.workspaceManager.addCustomCase(dir, input, output);
      void vscode.window.showInformationMessage(`已添加用例 #${n}`);
    }),

    vscode.commands.registerCommand('ojAgent.platform.openCode', async (arg?: ProblemRef) => {
      if (!arg || !arg.platform || !arg.id) {
        void vscode.window.showWarningMessage('缺少题目信息');
        return;
      }
      const root = resolveWorkspaceRoot(services.configBackend);
      const dir = await findProblemDir(root, arg);
      if (!dir) {
        void vscode.window.showWarningMessage('题目尚未拉取到本地');
        return;
      }
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      // 优先按"最近编辑的语言"打开（inferLangFromDir 已用 mtime 排序消除 Main.java 抢占）；
      // 推断结果不存在或目录里没有对应文件时，再按目录扫描兜底。
      const defaultLang = services.configBackend.get<JudgeLang>('ui.defaultLang') ?? 'cpp';
      const inferredLang = await inferLangFromDir(dir, defaultLang);
      const want = solutionFilenameForLang(inferredLang);
      let target: string | undefined = files.includes(want) ? want : undefined;
      if (!target) {
        target = files.find((f) => /^solution\.[a-z]+$/i.test(f) || f === 'Main.java');
      }
      if (!target) {
        void vscode.window.showWarningMessage('未找到 solution.* 或 Main.java');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(path.join(dir, target));
      await vscode.window.showTextDocument(doc, pickOpenColumn());
    }),

    vscode.commands.registerCommand('ojAgent.platform.revealProblemDir', async (arg?: ProblemRef) => {
      if (!arg || !arg.platform || !arg.id) {
        void vscode.window.showWarningMessage('缺少题目信息');
        return;
      }
      const root = resolveWorkspaceRoot(services.configBackend);
      const dir = await findProblemDir(root, arg);
      if (!dir) {
        void vscode.window.showWarningMessage('题目尚未拉取到本地');
        return;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    }),

    vscode.commands.registerCommand('ojAgent.platform.copyProblemId', async (arg?: unknown) => {
      const ref = toProblemRef(arg);
      if (!ref?.id) return;
      await vscode.env.clipboard.writeText(ref.id);
      void vscode.window.showInformationMessage(`已复制: ${ref.id}`);
    }),

    vscode.commands.registerCommand('ojAgent.workspace.setRoot', async () => {
      const sel = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '选择 OJ 工作区根目录',
      });
      if (!sel || sel.length === 0) return;
      await services.configBackend.update('workspace.root', sel[0]!.fsPath);
      void vscode.window.showInformationMessage(`工作区根目录已设为 ${sel[0]!.fsPath}`);
    }),

    vscode.commands.registerCommand('ojAgent.openOutputChannel', () => {
      services.logger.show(true);
    }),
  ];
}

async function buildUrl(ref: ProblemRef): Promise<string | undefined> {
  switch (ref.platform) {
    case 'leetcode-cn':
      return `https://leetcode.cn/problems/${ref.slug ?? ref.id}/`;
    case 'hdoj':
      return `http://acm.hdu.edu.cn/showproblem.php?pid=${ref.id}`;
    case 'codeforces': {
      // ref.id 形如 "1900A"
      const m = ref.id.match(/^(\d+)([A-Z]\d?)$/i);
      if (!m) return undefined;
      return `https://codeforces.com/contest/${m[1]}/problem/${m[2]!.toUpperCase()}`;
    }
    case 'luogu':
      return `https://www.luogu.com.cn/problem/${ref.id}`;
    case 'poj':
      return `http://poj.org/problem?id=${ref.id}`;
    case 'lanqiao':
      return `https://www.lanqiao.cn/problems/${ref.id}/learning/`;
    default:
      return undefined;
  }
}

function toProblemRef(arg: unknown): ProblemRef | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const a = arg as Record<string, unknown>;
  if (a.kind === 'problem' && a.platform && a.summary && typeof a.summary === 'object') {
    const sum = a.summary as { id?: string; url?: string };
    if (!sum.id) return undefined;
    return { platform: a.platform as PlatformId, id: sum.id, slug: extractSlugFromUrl(sum.url) };
  }
  if (typeof a.platform === 'string' && typeof a.id === 'string') {
    return { platform: a.platform as PlatformId, id: a.id, slug: typeof a.slug === 'string' ? a.slug : undefined };
  }
  return undefined;
}

function extractSlugFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/problems\/([^/?#]+)/);
  return m?.[1];
}

/** lang → 该 lang 对应的 solution 文件名（与 extension.ts 中同名函数行为一致）。 */
function solutionFilenameForLang(lang: JudgeLang): string {
  switch (lang) {
    case 'cpp': return 'solution.cpp';
    case 'c': return 'solution.c';
    case 'python3': return 'solution.py';
    case 'java': return 'Main.java';
    case 'javascript': return 'solution.js';
  }
}
