import * as vscode from 'vscode';
import type { AIServices } from './services.js';

type Node =
  | { kind: 'profile'; profileId: string }
  | { kind: 'empty' };

export class AIProfilesProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly services: AIServices) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem('未配置 Profile，点击新建');
      item.iconPath = new vscode.ThemeIcon('add');
      item.command = { command: 'ojAgent.ai.addProfile', title: '新建 Profile' };
      item.contextValue = 'empty';
      return item;
    }
    const profile = this.services.profiles.list().find((p) => p.id === node.profileId);
    if (!profile) {
      const stale = new vscode.TreeItem('(已删除)');
      stale.contextValue = 'stale';
      return stale;
    }
    const active = profile.id === this.services.profiles.getActiveId();
    const item = new vscode.TreeItem(profile.label, vscode.TreeItemCollapsibleState.None);
    item.description = `${profile.provider} · ${profile.model}${active ? ' · 活动' : ''}`;
    item.tooltip = [
      `Provider: ${profile.provider}`,
      `Model: ${profile.model}`,
      profile.baseUrl ? `BaseURL: ${profile.baseUrl}` : 'BaseURL: (官方)',
      `temp=${profile.temperature ?? 0.2}, maxOut=${profile.maxOutputTokens ?? 2048}`,
    ].join('\n');
    item.iconPath = new vscode.ThemeIcon(active ? 'star-full' : 'circle-outline');
    item.contextValue = active ? 'profile-active' : 'profile-inactive';
    item.command = {
      command: 'ojAgent.ai.editProfileInline',
      title: '编辑 Profile',
      arguments: [profile.id],
    };
    return item;
  }

  getChildren(): Node[] {
    const list = this.services.profiles.list();
    if (list.length === 0) return [{ kind: 'empty' }];
    return list.map((p): Node => ({ kind: 'profile', profileId: p.id }));
  }
}

type ActionNode = { kind: 'action'; commandId: string; label: string; icon: string; description?: string };

export class AIActionsProvider implements vscode.TreeDataProvider<ActionNode> {
  private readonly emitter = new vscode.EventEmitter<ActionNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: ActionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label);
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.description = node.description;
    item.command = { command: node.commandId, title: node.label };
    return item;
  }

  getChildren(): ActionNode[] {
    return [
      { kind: 'action', label: '打开 AI 助手面板', icon: 'comment-discussion', commandId: 'ojAgent.ai.openPanel' },
      { kind: 'action', label: 'AI · 解释错因', icon: 'bug', commandId: 'ojAgent.ai.explainError' },
      { kind: 'action', label: 'AI · 生成解题思路', icon: 'lightbulb', commandId: 'ojAgent.ai.generateApproach' },
      { kind: 'action', label: 'AI · 生成完整题解', icon: 'rocket', commandId: 'ojAgent.ai.generateSolution' },
      { kind: 'action', label: 'AI · 解释当前代码', icon: 'symbol-method', commandId: 'ojAgent.ai.explainCode' },
      { kind: 'action', label: '切换 AI 模型 Profile', icon: 'arrow-swap', commandId: 'ojAgent.ai.switchProfile' },
      { kind: 'action', label: '测试连接', icon: 'plug', commandId: 'ojAgent.ai.testConnection' },
    ];
  }
}
