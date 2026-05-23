import * as vscode from 'vscode';
import type {
  PlatformId,
  PlatformAdapterRegistry,
  PlatformListQuery,
  PlatformProblemSummary,
  CredentialChecker,
  CredentialStatus,
} from '@oj-agent/core';
import type { VSCodeConfigBackend } from '../backends/vscode-config.js';
import { getEnabledPlatforms } from '../oj-services.js';

export type ProblemTreeNode =
  | { kind: 'platform'; platform: PlatformId }
  | { kind: 'problem'; platform: PlatformId; summary: PlatformProblemSummary }
  | { kind: 'action'; platform: PlatformId; summary: PlatformProblemSummary; action: ProblemAction }
  | { kind: 'empty'; platform: PlatformId; reason: 'loading' | 'no-data' | 'not-logged-in' | 'error'; message?: string };

type ProblemAction = 'pull' | 'openProblem' | 'openCode' | 'runTest' | 'submit';

interface PlatformState {
  query: PlatformListQuery;
  page: number;
  pageSize: number;
  cache?: PlatformProblemSummary[];
  loading: boolean;
  lastError?: string;
  credStatus: CredentialStatus;
}

const DEFAULT_PAGE_SIZE = 50;

function queryStateKey(platform: PlatformId): string {
  return `ojAgent.problems.${platform}.query`;
}

const ACTION_CONFIG: Record<ProblemAction, { label: string; icon: string; command: string }> = {
  pull:        { label: '拉取到本地',     icon: 'cloud-download',  command: 'ojAgent.platform.pullProblem' },
  openProblem: { label: '打开题面',       icon: 'preview',         command: 'ojAgent.platform.openProblemView' },
  openCode:    { label: '打开解题代码',   icon: 'file-code',       command: 'ojAgent.platform.openCode' },
  runTest:     { label: '运行测试',       icon: 'play',            command: 'ojAgent.judge.runAll' },
  submit:      { label: '提交',           icon: 'cloud-upload',    command: 'ojAgent.submission.submit' },
};

const PROBLEM_ACTIONS: ProblemAction[] = ['pull', 'openProblem', 'openCode', 'runTest', 'submit'];

export class ProblemTreeDataProvider implements vscode.TreeDataProvider<ProblemTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ProblemTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private readonly states = new Map<PlatformId, PlatformState>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly registry: PlatformAdapterRegistry,
    private readonly credentialChecker: CredentialChecker,
    private readonly configBackend: VSCodeConfigBackend,
  ) {}

  refresh(): void {
    for (const s of this.states.values()) s.cache = undefined;
    this.emitter.fire(undefined);
  }

  refreshPlatform(_platform: PlatformId): void {
    const s = this.states.get(_platform);
    if (s) s.cache = undefined;
    this.emitter.fire(undefined);
  }

  async setQuery(platform: PlatformId, query: Partial<PlatformListQuery>): Promise<void> {
    const s = this.getOrInitState(platform);
    s.query = { ...s.query, ...query };
    s.page = query.page ?? 1;
    s.cache = undefined;
    await this.ctx.workspaceState.update(queryStateKey(platform), s.query);
    this.emitter.fire(undefined);
  }

  getQuery(platform: PlatformId): PlatformListQuery {
    return this.getOrInitState(platform).query;
  }

  nextPage(platform: PlatformId): void {
    const s = this.getOrInitState(platform);
    s.query = { ...s.query, page: (s.query.page ?? 1) + 1 };
    s.cache = undefined;
    void this.ctx.workspaceState.update(queryStateKey(platform), s.query);
    this.emitter.fire(undefined);
  }

  prevPage(platform: PlatformId): void {
    const s = this.getOrInitState(platform);
    const cur = s.query.page ?? 1;
    if (cur <= 1) return;
    s.query = { ...s.query, page: cur - 1 };
    s.cache = undefined;
    void this.ctx.workspaceState.update(queryStateKey(platform), s.query);
    this.emitter.fire(undefined);
  }

  getTreeItem(node: ProblemTreeNode): vscode.TreeItem {
    if (node.kind === 'platform') {
      const s = this.getOrInitState(node.platform);
      const item = new vscode.TreeItem(this.platformLabel(node.platform), vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('account');
      item.description = this.platformDesc(s);
      item.tooltip = this.platformTooltip(node.platform, s);
      item.contextValue = s.credStatus === 'valid' ? 'platform-loggedin' : 'platform-loggedout';
      return item;
    }

    if (node.kind === 'action') {
      const cfg = ACTION_CONFIG[node.action];
      const ref = { platform: node.platform, id: node.summary.id, slug: extractSlug(node.summary.url) };
      const item = new vscode.TreeItem(cfg.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(cfg.icon);
      item.contextValue = `problem-action-${node.action}`;
      item.command = {
        command: cfg.command,
        title: cfg.label,
        arguments: [ref],
      };
      return item;
    }

    if (node.kind === 'problem') {
      const sum = node.summary;
      const item = new vscode.TreeItem(`${sum.id}. ${sum.title}`, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('symbol-event', this.difficultyColor(sum.difficulty));
      item.description = [sum.difficulty, (sum.tags ?? []).slice(0, 3).join(',')].filter(Boolean).join(' · ');
      item.tooltip = sum.url ?? '';
      item.contextValue = 'problem';
      return item;
    }

    // empty
    let label: string;
    switch (node.reason) {
      case 'loading':
        label = '加载中...';
        break;
      case 'not-logged-in':
        label = '未登录 · 点击右键登录';
        break;
      case 'no-data':
        label = '(暂无数据)';
        break;
      case 'error':
        label = `加载失败: ${node.message ?? ''}`;
        break;
    }
    const item = new vscode.TreeItem(label);
    item.contextValue = `empty-${node.reason}`;
    item.iconPath = new vscode.ThemeIcon(node.reason === 'error' ? 'error' : 'info');
    return item;
  }

  async getChildren(node?: ProblemTreeNode): Promise<ProblemTreeNode[]> {
    if (!node) {
      const enabled = getEnabledPlatforms(this.configBackend);
      for (const p of enabled) this.kickoffCredCheck(p);
      return enabled.map((platform): ProblemTreeNode => ({ kind: 'platform', platform }));
    }

    if (node.kind === 'platform') {
      const s = this.getOrInitState(node.platform);
      if (s.cache) {
        if (s.cache.length === 0) return [{ kind: 'empty', platform: node.platform, reason: 'no-data' }];
        return s.cache.map((summary): ProblemTreeNode => ({ kind: 'problem', platform: node.platform, summary }));
      }
      if (s.loading) return [{ kind: 'empty', platform: node.platform, reason: 'loading' }];

      s.loading = true;
      try {
        const adapter = this.registry.get(node.platform);
        const list = await adapter.listProblems({
          ...s.query,
          page: s.query.page ?? 1,
          pageSize: s.query.pageSize ?? s.pageSize,
        });
        s.cache = list;
        s.lastError = undefined;
      } catch (e) {
        s.cache = [];
        s.lastError = e instanceof Error ? e.message : String(e);
        if (/AUTH_REQUIRED|401|未登录/i.test(s.lastError)) {
          return [{ kind: 'empty', platform: node.platform, reason: 'not-logged-in' }];
        }
        return [{ kind: 'empty', platform: node.platform, reason: 'error', message: s.lastError }];
      } finally {
        s.loading = false;
      }
      if (s.cache.length === 0) return [{ kind: 'empty', platform: node.platform, reason: 'no-data' }];
      return s.cache.map((summary): ProblemTreeNode => ({ kind: 'problem', platform: node.platform, summary }));
    }

    if (node.kind === 'problem') {
      // 展开 5 个 action 子节点
      return PROBLEM_ACTIONS.map((action): ProblemTreeNode => ({
        kind: 'action',
        platform: node.platform,
        summary: node.summary,
        action,
      }));
    }

    return [];
  }

  private getOrInitState(platform: PlatformId): PlatformState {
    let s = this.states.get(platform);
    if (!s) {
      const persisted = this.ctx.workspaceState.get<PlatformListQuery>(queryStateKey(platform));
      s = {
        query: persisted ?? { page: 1, pageSize: DEFAULT_PAGE_SIZE },
        page: persisted?.page ?? 1,
        pageSize: persisted?.pageSize ?? DEFAULT_PAGE_SIZE,
        cache: undefined,
        loading: false,
        credStatus: 'unknown',
      };
      this.states.set(platform, s);
    }
    return s;
  }

  private kickoffCredCheck(platform: PlatformId): void {
    const s = this.getOrInitState(platform);
    void this.credentialChecker
      .check(platform)
      .then((st) => {
        if (s.credStatus !== st) {
          s.credStatus = st;
          this.emitter.fire(undefined);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }

  private platformLabel(platform: PlatformId): string {
    switch (platform) {
      case 'leetcode-cn':
        return 'LeetCode CN';
      case 'hdoj':
        return 'HDOJ';
      case 'codeforces':
        return 'Codeforces';
      case 'luogu':
        return '洛谷';
      case 'poj':
        return 'POJ';
      case 'lanqiao':
        return '蓝桥云课';
      default:
        return platform;
    }
  }

  private platformDesc(s: PlatformState): string {
    const parts: string[] = [];
    if (s.credStatus === 'valid') parts.push('已登录');
    else if (s.credStatus === 'expired') parts.push('未登录');
    if (s.query.keyword) parts.push(`kw:${s.query.keyword}`);
    if (s.query.difficulty) parts.push(s.query.difficulty);
    if (s.query.tags?.length) parts.push(`tags:${s.query.tags.length}`);
    parts.push(`P${s.query.page ?? 1}`);
    return parts.join(' · ');
  }

  private platformTooltip(platform: PlatformId, s: PlatformState): string {
    return [
      `平台: ${this.platformLabel(platform)}`,
      `登录: ${s.credStatus}`,
      `分页: ${s.query.page ?? 1} (size=${s.query.pageSize ?? DEFAULT_PAGE_SIZE})`,
      s.query.keyword ? `关键字: ${s.query.keyword}` : '',
      s.query.difficulty ? `难度: ${s.query.difficulty}` : '',
      s.query.tags?.length ? `标签: ${s.query.tags.join(',')}` : '',
      s.lastError ? `最近错误: ${s.lastError}` : '',
    ].filter(Boolean).join('\n');
  }

  private difficultyColor(diff?: string): vscode.ThemeColor | undefined {
    if (!diff) return undefined;
    const d = diff.toLowerCase();
    if (d.includes('easy') || d.includes('简单')) return new vscode.ThemeColor('charts.green');
    if (d.includes('medium') || d.includes('中等')) return new vscode.ThemeColor('charts.yellow');
    if (d.includes('hard') || d.includes('困难')) return new vscode.ThemeColor('charts.red');
    return undefined;
  }
}

function extractSlug(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/problems\/([^/?#]+)/);
  return m?.[1];
}
