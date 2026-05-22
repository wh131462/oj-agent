import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { JudgeLang, PlatformId } from '@oj-agent/core';
import type { OJServices } from '../oj-services.js';
import { resolveWorkspaceRoot } from '../oj-services.js';
import type { ProblemRef } from '../utils/problem-ref.js';
import { parseProblemUrl } from '../utils/problem-ref.js';
import { findProblemDir, inferRefFromDir } from '../utils/workspace-resolver.js';
import type { ProblemWebviewManager } from '../views/problem-webview.js';

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
      const detail = await adapter.getProblem(ref.id);
      await services.workspaceManager.writeProblem(detail, { rootDir: root, defaultLang });
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

    vscode.commands.registerCommand('ojAgent.platform.openInBrowser', async (arg?: ProblemRef) => {
      if (!arg) return;
      const url = await buildUrl(arg);
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
        const detail = await services.registry.get(arg.platform).getProblem(arg.id);
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

    vscode.commands.registerCommand('ojAgent.platform.copyProblemId', async (arg?: ProblemRef) => {
      if (!arg?.id) return;
      await vscode.env.clipboard.writeText(arg.id);
      void vscode.window.showInformationMessage(`已复制: ${arg.id}`);
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
  if (ref.platform === 'leetcode-cn') {
    return `https://leetcode.cn/problems/${ref.slug ?? ref.id}/`;
  }
  if (ref.platform === 'hdoj') {
    return `http://acm.hdu.edu.cn/showproblem.php?pid=${ref.id}`;
  }
  return undefined;
}

// 占位:让 unused import 不报错
void ((p: PlatformId) => p);
