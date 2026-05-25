import * as vscode from 'vscode';
import type { PlatformId } from '@oj-agent/core';
import type { ProblemTreeDataProvider } from '../views/problem-tree.js';
import type { OJServices } from '../oj-services.js';
import { getEnabledPlatforms } from '../oj-services.js';

async function pickPlatform(services: OJServices, placeHolder: string): Promise<PlatformId | undefined> {
  const enabled = getEnabledPlatforms(services.configBackend);
  if (enabled.length === 0) {
    void vscode.window.showWarningMessage('未启用任何 OJ 平台,请在设置中配置 ojAgent.platforms.enabled。');
    return undefined;
  }
  if (enabled.length === 1) return enabled[0];
  const pick = await vscode.window.showQuickPick(
    enabled.map((p) => ({ label: p })),
    { placeHolder },
  );
  return (pick?.label as PlatformId | undefined);
}

/**
 * 从命令参数中提取 platform：
 * - 直接传字符串（控制节点 command.arguments）
 * - 传 ProblemTreeNode（contextMenu 默认参数）
 * - 否则 fallback 到 pickPlatform()
 */
async function resolvePlatform(
  services: OJServices,
  arg: unknown,
  placeHolder: string,
): Promise<PlatformId | undefined> {
  if (typeof arg === 'string') return arg as PlatformId;
  if (arg && typeof arg === 'object' && 'platform' in arg) {
    const p = (arg as { platform?: unknown }).platform;
    if (typeof p === 'string') return p as PlatformId;
  }
  return pickPlatform(services, placeHolder);
}

export function registerProblemTreeCommands(
  services: OJServices,
  tree: ProblemTreeDataProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.problems.refresh', () => tree.refresh()),

    vscode.commands.registerCommand('ojAgent.problems.search', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择要搜索的平台');
      if (!platform) return;
      const cur = tree.getQuery(platform);
      const keyword = await vscode.window.showInputBox({
        prompt: '关键字(留空清除)',
        value: cur.keyword ?? '',
      });
      if (keyword === undefined) return;
      await tree.setQuery(platform, { keyword: keyword || undefined, page: 1 });
    }),

    vscode.commands.registerCommand('ojAgent.problems.filterDifficulty', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择要筛选的平台');
      if (!platform) return;
      const pick = await vscode.window.showQuickPick(
        [
          { label: '(不限)', value: undefined },
          { label: 'Easy', value: 'Easy' },
          { label: 'Medium', value: 'Medium' },
          { label: 'Hard', value: 'Hard' },
        ],
        { placeHolder: '选择难度' },
      );
      if (!pick) return;
      await tree.setQuery(platform, { difficulty: pick.value, page: 1 });
    }),

    vscode.commands.registerCommand('ojAgent.problems.filterTags', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择要筛选的平台');
      if (!platform) return;
      const cur = tree.getQuery(platform);
      const input = await vscode.window.showInputBox({
        prompt: '标签(逗号分隔,留空清除)',
        value: (cur.tags ?? []).join(','),
      });
      if (input === undefined) return;
      const tags = input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await tree.setQuery(platform, { tags: tags.length > 0 ? tags : undefined, page: 1 });
    }),

    vscode.commands.registerCommand('ojAgent.problems.prevPage', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择平台');
      if (!platform) return;
      tree.prevPage(platform);
    }),

    vscode.commands.registerCommand('ojAgent.problems.nextPage', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择平台');
      if (!platform) return;
      tree.nextPage(platform);
    }),

    vscode.commands.registerCommand('ojAgent.problems.jumpToPage', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择平台');
      if (!platform) return;
      const cur = tree.getQuery(platform).page ?? 1;
      const input = await vscode.window.showInputBox({
        prompt: '跳转到第几页',
        value: String(cur),
        validateInput: (v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return '请输入正整数';
          return null;
        },
      });
      if (input === undefined) return;
      const page = Number(input);
      if (page === cur) return;
      tree.jumpToPage(platform, page);
    }),

    vscode.commands.registerCommand('ojAgent.problems.resetFilters', async (arg?: unknown) => {
      const platform = await resolvePlatform(services, arg, '选择平台');
      if (!platform) return;
      tree.resetFilters(platform);
    }),

    vscode.commands.registerCommand('ojAgent.problems.addCaseFromTree', async (node?: unknown) => {
      const ref = extractRefFromFileGroupNode(node);
      if (!ref) {
        void vscode.window.showWarningMessage('请从「测试用例」分组节点右键调用');
        return;
      }
      await vscode.commands.executeCommand('ojAgent.platform.addCustomCase', ref);
      tree.refresh();
    }),

    vscode.commands.registerCommand('ojAgent.problems.removeCaseFromTree', async (node?: unknown) => {
      const info = extractCustomCaseInfo(node);
      if (!info) {
        void vscode.window.showWarningMessage('只能删除自定义用例');
        return;
      }
      const path = await import('node:path');
      const dir = path.dirname(path.dirname(info.filePath)); // .../cases/in_n.txt → problemDir
      const confirm = await vscode.window.showWarningMessage(
        `确定删除自定义用例 #${info.caseIndex}?`,
        { modal: true },
        '删除',
      );
      if (confirm !== '删除') return;
      const ok = await services.workspaceManager.removeCustomCase(dir, info.caseIndex);
      if (ok) {
        void vscode.window.showInformationMessage(`已删除用例 #${info.caseIndex}`);
        tree.refresh();
      } else {
        void vscode.window.showWarningMessage('删除失败：该编号未登记为自定义用例');
      }
    }),
  ];
}

function extractRefFromFileGroupNode(node: unknown): { platform: PlatformId; id: string; slug?: string } | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as {
    kind?: unknown;
    platform?: unknown;
    summary?: { id?: unknown; url?: unknown };
  };
  if (n.kind !== 'fileGroup' && n.kind !== 'problem') return undefined;
  if (typeof n.platform !== 'string' || !n.summary || typeof n.summary.id !== 'string') return undefined;
  const slug = typeof n.summary.url === 'string'
    ? n.summary.url.match(/\/problems\/([^/?#]+)/)?.[1]
    : undefined;
  return { platform: n.platform as PlatformId, id: n.summary.id, slug };
}

function extractCustomCaseInfo(node: unknown): { caseIndex: number; filePath: string } | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as { kind?: unknown; isCustomCase?: unknown; caseIndex?: unknown; filePath?: unknown };
  if (n.kind !== 'file' || n.isCustomCase !== true) return undefined;
  if (typeof n.caseIndex !== 'number' || typeof n.filePath !== 'string') return undefined;
  return { caseIndex: n.caseIndex, filePath: n.filePath };
}
