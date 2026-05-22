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

export function registerProblemTreeCommands(
  services: OJServices,
  tree: ProblemTreeDataProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.problems.refresh', () => tree.refresh()),

    vscode.commands.registerCommand('ojAgent.problems.search', async () => {
      const platform = await pickPlatform(services, '选择要搜索的平台');
      if (!platform) return;
      const cur = tree.getQuery(platform);
      const keyword = await vscode.window.showInputBox({
        prompt: '关键字(留空清除)',
        value: cur.keyword ?? '',
      });
      if (keyword === undefined) return;
      await tree.setQuery(platform, { keyword: keyword || undefined, page: 1 });
    }),

    vscode.commands.registerCommand('ojAgent.problems.filterDifficulty', async () => {
      const platform = await pickPlatform(services, '选择要筛选的平台');
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

    vscode.commands.registerCommand('ojAgent.problems.filterTags', async () => {
      const platform = await pickPlatform(services, '选择要筛选的平台');
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

    vscode.commands.registerCommand('ojAgent.problems.prevPage', async () => {
      const platform = await pickPlatform(services, '选择平台');
      if (!platform) return;
      tree.prevPage(platform);
    }),

    vscode.commands.registerCommand('ojAgent.problems.nextPage', async () => {
      const platform = await pickPlatform(services, '选择平台');
      if (!platform) return;
      tree.nextPage(platform);
    }),
  ];
}
