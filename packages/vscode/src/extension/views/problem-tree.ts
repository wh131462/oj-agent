import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  PlatformId,
  PlatformAdapterRegistry,
  PlatformListQuery,
  PlatformProblemSummary,
  CredentialChecker,
  CredentialStatus,
  CredentialStore,
} from '@oj-agent/core';
import type { VSCodeConfigBackend } from '../backends/vscode-config.js';
import { getEnabledPlatforms, resolveWorkspaceRoot } from '../oj-services.js';
import { findProblemDir } from '../utils/workspace-resolver.js';

export type ProblemTreeNode =
  | { kind: 'platform'; platform: PlatformId }
  | { kind: 'control'; platform: PlatformId; control: ControlKind }
  | { kind: 'problem'; platform: PlatformId; summary: PlatformProblemSummary }
  | { kind: 'action'; platform: PlatformId; summary: PlatformProblemSummary; action: ProblemAction }
  | { kind: 'fileGroup'; platform: PlatformId; summary: PlatformProblemSummary; group: FileGroupKind; dir: string }
  | { kind: 'file'; platform: PlatformId; summary: PlatformProblemSummary; filePath: string; label: string; description?: string; caseIndex?: number; isCustomCase?: boolean }
  | { kind: 'empty'; platform: PlatformId; reason: 'loading' | 'no-data' | 'not-logged-in' | 'error'; message?: string };

type ProblemAction = 'pull' | 'openProblem' | 'openCode' | 'runTest' | 'submit';
type ControlKind = 'search' | 'difficulty' | 'tags' | 'pager' | 'prevPage' | 'nextPage' | 'reset';
type FileGroupKind = 'solution' | 'cases';

interface PlatformState {
  query: PlatformListQuery;
  page: number;
  pageSize: number;
  cache?: PlatformProblemSummary[];
  loading: boolean;
  lastError?: string;
  credStatus: CredentialStatus;
  username?: string;
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
    private readonly credentialStore: CredentialStore,
  ) {}

  refresh(): void {
    for (const s of this.states.values()) s.cache = undefined;
    this.emitter.fire(undefined);
  }

  /**
   * 仅刷新本地文件相关子节点（解题代码/测试用例分组），不清空平台列表 cache。
   * 用于 FileSystemWatcher 事件 —— 避免每次文件变动都重新拉取远端列表。
   */
  refreshLocalFiles(): void {
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

  jumpToPage(platform: PlatformId, page: number): void {
    const s = this.getOrInitState(platform);
    const target = Math.max(1, Math.floor(page));
    s.query = { ...s.query, page: target };
    s.cache = undefined;
    void this.ctx.workspaceState.update(queryStateKey(platform), s.query);
    this.emitter.fire(undefined);
  }

  resetFilters(platform: PlatformId): void {
    const s = this.getOrInitState(platform);
    s.query = { page: 1, pageSize: s.pageSize };
    s.cache = undefined;
    void this.ctx.workspaceState.update(queryStateKey(platform), s.query);
    this.emitter.fire(undefined);
  }

  hasActiveFilter(platform: PlatformId): boolean {
    const q = this.getOrInitState(platform).query;
    return !!(q.keyword || q.difficulty || (q.tags && q.tags.length > 0));
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

    if (node.kind === 'control') {
      return this.renderControl(node);
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

    if (node.kind === 'fileGroup') {
      const isSolution = node.group === 'solution';
      const item = new vscode.TreeItem(
        isSolution ? '解题代码' : '测试用例',
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(isSolution ? 'file-code' : 'beaker');
      item.contextValue = `problem-fileGroup-${node.group}`;
      item.tooltip = node.dir;
      return item;
    }

    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(node.isCustomCase ? 'edit' : 'file');
      if (node.description) item.description = node.description;
      item.tooltip = node.filePath;
      item.contextValue = node.isCustomCase ? 'problem-file-custom' : 'problem-file';
      item.resourceUri = vscode.Uri.file(node.filePath);
      item.command = {
        command: 'vscode.open',
        title: '打开',
        arguments: [vscode.Uri.file(node.filePath), { viewColumn: vscode.ViewColumn.One }],
      };
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
        label = node.message ?? '(暂无数据)';
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
      const controls: ProblemTreeNode[] = this.buildControlNodes(node.platform, s);

      if (s.cache) {
        if (s.cache.length === 0) {
          return [...controls, { kind: 'empty', platform: node.platform, reason: 'no-data' }];
        }
        return [
          ...controls,
          ...s.cache.map((summary): ProblemTreeNode => ({ kind: 'problem', platform: node.platform, summary })),
        ];
      }
      if (s.loading) return [...controls, { kind: 'empty', platform: node.platform, reason: 'loading' }];

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
          return [...controls, { kind: 'empty', platform: node.platform, reason: 'not-logged-in' }];
        }
        return [...controls, { kind: 'empty', platform: node.platform, reason: 'error', message: s.lastError }];
      } finally {
        s.loading = false;
      }
      if (s.cache.length === 0) return [...controls, { kind: 'empty', platform: node.platform, reason: 'no-data' }];
      return [
        ...controls,
        ...s.cache.map((summary): ProblemTreeNode => ({ kind: 'problem', platform: node.platform, summary })),
      ];
    }

    if (node.kind === 'problem') {
      const actionNodes: ProblemTreeNode[] = PROBLEM_ACTIONS.map((action): ProblemTreeNode => ({
        kind: 'action',
        platform: node.platform,
        summary: node.summary,
        action,
      }));
      const ref = {
        platform: node.platform,
        id: node.summary.id,
        slug: extractSlug(node.summary.url),
      };
      const dir = await findProblemDir(resolveWorkspaceRoot(this.configBackend), ref);
      if (!dir) return actionNodes;
      return [
        ...actionNodes,
        { kind: 'fileGroup', platform: node.platform, summary: node.summary, group: 'solution', dir },
        { kind: 'fileGroup', platform: node.platform, summary: node.summary, group: 'cases', dir },
      ];
    }

    if (node.kind === 'fileGroup') {
      return this.getFileGroupChildren(node);
    }

    return [];
  }

  private async getFileGroupChildren(
    node: Extract<ProblemTreeNode, { kind: 'fileGroup' }>,
  ): Promise<ProblemTreeNode[]> {
    if (node.group === 'solution') {
      const files = await fs.readdir(node.dir).catch(() => [] as string[]);
      const target = files.find((f) => f === 'Main.java')
        ?? files.find((f) => /^solution\.[a-z]+$/i.test(f));
      if (!target) {
        return [{ kind: 'empty', platform: node.platform, reason: 'no-data', message: '暂无源文件' }];
      }
      return [{
        kind: 'file',
        platform: node.platform,
        summary: node.summary,
        filePath: path.join(node.dir, target),
        label: target,
      }];
    }
    // cases
    const casesDir = path.join(node.dir, 'cases');
    const entries = await fs.readdir(casesDir).catch(() => [] as string[]);
    const customIndices = await readCustomCaseIndices(node.dir);
    const indexSet = new Set<number>();
    const inMap = new Map<number, string>();
    const outMap = new Map<number, string>();
    for (const f of entries) {
      const mi = f.match(/^in_(\d+)\.txt$/);
      if (mi) {
        const n = Number(mi[1]);
        indexSet.add(n);
        inMap.set(n, f);
        continue;
      }
      const mo = f.match(/^out_(\d+)\.txt$/);
      if (mo) {
        const n = Number(mo[1]);
        indexSet.add(n);
        outMap.set(n, f);
      }
    }
    if (indexSet.size === 0) {
      return [{ kind: 'empty', platform: node.platform, reason: 'no-data', message: '暂无用例' }];
    }
    const sorted = [...indexSet].sort((a, b) => a - b);
    const children: ProblemTreeNode[] = [];
    for (const n of sorted) {
      const isCustom = customIndices.has(n);
      const labelSuffix = isCustom ? ' · 自定义' : '';
      const inName = inMap.get(n);
      if (inName) {
        children.push({
          kind: 'file',
          platform: node.platform,
          summary: node.summary,
          filePath: path.join(casesDir, inName),
          label: `#${n} 输入${labelSuffix}`,
          description: inName,
          caseIndex: n,
          isCustomCase: isCustom,
        });
      }
      const outName = outMap.get(n);
      if (outName) {
        children.push({
          kind: 'file',
          platform: node.platform,
          summary: node.summary,
          filePath: path.join(casesDir, outName),
          label: `#${n} 输出${labelSuffix}`,
          description: outName,
          caseIndex: n,
          isCustomCase: isCustom,
        });
      }
    }
    return children;
  }

  private buildControlNodes(platform: PlatformId, _s: PlatformState): ProblemTreeNode[] {
    // 紧凑布局：搜索 / 难度 / 标签 / 分页 / 重置（仅在有筛选时显示）
    const nodes: ProblemTreeNode[] = [
      { kind: 'control', platform, control: 'search' },
      { kind: 'control', platform, control: 'difficulty' },
      { kind: 'control', platform, control: 'tags' },
      { kind: 'control', platform, control: 'prevPage' },
      { kind: 'control', platform, control: 'pager' },
      { kind: 'control', platform, control: 'nextPage' },
    ];
    if (this.hasActiveFilter(platform)) {
      nodes.push({ kind: 'control', platform, control: 'reset' });
    }
    return nodes;
  }

  private renderControl(node: { platform: PlatformId; control: ControlKind }): vscode.TreeItem {
    const s = this.getOrInitState(node.platform);
    const q = s.query;
    switch (node.control) {
      case 'search': {
        const has = !!q.keyword;
        const label = has ? `搜索: ${q.keyword}` : '搜索...';
        const item = new vscode.TreeItem(label);
        item.iconPath = new vscode.ThemeIcon(has ? 'search-fuzzy' : 'search');
        item.tooltip = has ? '点击修改搜索关键字（右键可清除）' : '点击输入搜索关键字';
        item.contextValue = has ? 'control-search-active' : 'control-search';
        item.command = {
          command: 'ojAgent.problems.search',
          title: '搜索',
          arguments: [node.platform],
        };
        return item;
      }
      case 'difficulty': {
        const has = !!q.difficulty;
        const label = has ? `难度: ${q.difficulty}` : '难度: 全部';
        const item = new vscode.TreeItem(label);
        item.iconPath = new vscode.ThemeIcon('filter');
        item.tooltip = '按难度筛选';
        item.contextValue = has ? 'control-difficulty-active' : 'control-difficulty';
        item.command = {
          command: 'ojAgent.problems.filterDifficulty',
          title: '难度',
          arguments: [node.platform],
        };
        return item;
      }
      case 'tags': {
        const tags = q.tags ?? [];
        const label = tags.length > 0 ? `标签: ${tags.join(', ')}` : '标签: 全部';
        const item = new vscode.TreeItem(label);
        item.iconPath = new vscode.ThemeIcon('tag');
        item.tooltip = '按标签筛选';
        item.contextValue = tags.length > 0 ? 'control-tags-active' : 'control-tags';
        item.command = {
          command: 'ojAgent.problems.filterTags',
          title: '标签',
          arguments: [node.platform],
        };
        return item;
      }
      case 'prevPage': {
        const cur = q.page ?? 1;
        const item = new vscode.TreeItem('上一页');
        item.iconPath = new vscode.ThemeIcon('arrow-left');
        item.contextValue = 'control-prev';
        if (cur > 1) {
          item.command = {
            command: 'ojAgent.problems.prevPage',
            title: '上一页',
            arguments: [node.platform],
          };
        } else {
          item.description = '(已是第一页)';
        }
        return item;
      }
      case 'pager': {
        const cur = q.page ?? 1;
        const item = new vscode.TreeItem(`第 ${cur} 页`);
        item.iconPath = new vscode.ThemeIcon('book');
        item.tooltip = '点击跳转到指定页';
        item.contextValue = 'control-pager';
        item.command = {
          command: 'ojAgent.problems.jumpToPage',
          title: '跳页',
          arguments: [node.platform],
        };
        return item;
      }
      case 'nextPage': {
        const item = new vscode.TreeItem('下一页');
        item.iconPath = new vscode.ThemeIcon('arrow-right');
        item.contextValue = 'control-next';
        item.command = {
          command: 'ojAgent.problems.nextPage',
          title: '下一页',
          arguments: [node.platform],
        };
        return item;
      }
      case 'reset': {
        const item = new vscode.TreeItem('清除筛选');
        item.iconPath = new vscode.ThemeIcon('clear-all');
        item.tooltip = '清除所有搜索 / 难度 / 标签筛选';
        item.contextValue = 'control-reset';
        item.command = {
          command: 'ojAgent.problems.resetFilters',
          title: '清除筛选',
          arguments: [node.platform],
        };
        return item;
      }
    }
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
      .then(async (st) => {
        let username: string | undefined;
        let cred: import('@oj-agent/core').PlatformCredential | undefined;
        try {
          cred = await this.credentialStore.get(platform);
          username = cred?.extra?.username;
        } catch {
          /* ignore */
        }
        // unknown 状态时，若本地有凭证则视为已登录（poj/codeforces/luogu 无服务端校验逻辑）
        const effective: import('@oj-agent/core').CredentialStatus =
          st === 'unknown' && cred ? 'valid' : st;
        if (s.credStatus !== effective || s.username !== username) {
          s.credStatus = effective;
          s.username = username;
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
    if (s.credStatus === 'valid') {
      parts.push(s.username ? s.username : '已登录');
    } else if (s.credStatus === 'expired') {
      parts.push('未登录');
    }
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

async function readCustomCaseIndices(problemDir: string): Promise<Set<number>> {
  try {
    const raw = await fs.readFile(path.join(problemDir, 'meta.json'), 'utf-8');
    const meta = JSON.parse(raw) as { customCaseIndices?: unknown };
    const arr = Array.isArray(meta.customCaseIndices) ? meta.customCaseIndices : [];
    const set = new Set<number>();
    for (const v of arr) {
      if (typeof v === 'number' && Number.isInteger(v)) set.add(v);
    }
    return set;
  } catch {
    return new Set();
  }
}
