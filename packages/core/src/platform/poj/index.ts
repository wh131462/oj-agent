/**
 * POJ 平台适配器。
 * - HTML 爬取（GBK 编码）
 * - 30s 超时 + GET 重试 1 次（由 PLATFORM_HTTP_PROFILES 注入）
 * - 表单提交（GBK 编码 body）
 */

import { AdapterError } from '../errors.js';
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformCredential,
  PlatformListQuery,
  PlatformProblemDetail,
  PlatformProblemSummary,
  PlatformSubmissionId,
  PlatformJudgeResult,
  ProblemLangInfo,
} from '../adapter.js';
import type { RegistryDeps } from '../registry.js';
import { PojApi } from './api.js';
import {
  isLoginPage,
  parseListPage,
  parseProblemPage,
  parseStatusFirstRow,
  parseStatusRowByRunId,
} from './parse.js';

/** 用户语言 -> POJ language id（POJ /submit 表单提交字段，参考站点）。 */
const LANG_MAP: Record<string, number> = {
  cpp: 0, // G++
  c: 1,
  java: 2,
  // POJ 不支持 python / javascript：拒绝即可
};

/** UI 展示名（getProblemLangs 用），与 LANG_MAP 的 key 对齐。 */
const LANG_DISPLAY: Record<string, string> = {
  cpp: 'G++',
  c: 'GCC',
  java: 'Java',
};

export class POJAdapter implements PlatformAdapter {
  readonly id = 'poj' as const;
  readonly capabilities: PlatformCapabilities = {
    listProblems: true,
    getProblem: true,
    submit: true,
    pollResult: true,
    autoLogin: false,
  };
  readonly supportedLangs: readonly string[] = Object.keys(LANG_MAP);

  private readonly api: PojApi;

  constructor(private readonly deps: RegistryDeps) {
    this.api = new PojApi(deps.httpClient);
  }

  async login(): Promise<PlatformCredential> {
    throw new AdapterError(
      'AUTH_REQUIRED',
      'POJ 登录由前端实现：请通过浏览器登录或粘贴 cookie 后写入凭证仓库',
      false,
    );
  }

  async listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]> {
    const volume = Math.max(1, query.page ?? 1);
    const html = await this.api.fetchListHtml(volume);
    let items = await parseListPage(html);
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      items = items.filter(
        (p) => p.title.toLowerCase().includes(kw) || p.id.includes(kw),
      );
    }
    if (query.pageSize) items = items.slice(0, query.pageSize);
    return items;
  }

  async getProblem(pid: string): Promise<PlatformProblemDetail> {
    const html = await this.api.fetchProblemHtml(pid);
    if (/No such problem/i.test(html) || /unknown problem/i.test(html)) {
      throw new AdapterError('NOT_FOUND', `POJ 题目不存在: ${pid}`, false);
    }
    return parseProblemPage(html, pid);
  }

  /**
   * POJ 不提供题目级语言列表 API；所有题目支持的语言一致，
   * 直接由静态 LANG_MAP 包装为题目语言能力返回。
   */
  async getProblemLangs(_pid: string): Promise<ProblemLangInfo[]> {
    return Object.entries(LANG_MAP).map(([lang, id]) => ({
      lang,
      displayName: LANG_DISPLAY[lang] ?? lang,
      platformLangId: String(id),
    }));
  }

  async submit(pid: string, lang: string, code: string, platformLangId?: string): Promise<PlatformSubmissionId> {
    const cred = await this.deps.credentialStore.get(this.id);
    if (!cred?.cookie) {
      throw new AdapterError('AUTH_REQUIRED', '请先登录 POJ', false);
    }
    // platformLangId 由调用方通过 getProblemLangs 解析；缺省回退到静态 LANG_MAP。
    const langIdRaw = platformLangId ?? (LANG_MAP[lang] !== undefined ? String(LANG_MAP[lang]) : undefined);
    if (langIdRaw === undefined) {
      throw new AdapterError('LANG_UNSUPPORTED', `POJ 不支持语言: ${lang}`, false);
    }
    const username = cred.extra?.username;

    const { status, html } = await this.api.submit({
      problem_id: pid,
      language: langIdRaw,
      source: code,
      encoded: '0',
    });

    // 提交未登录会返回 login 页面
    if (isLoginPage(html)) {
      throw new AdapterError(
        'AUTH_EXPIRED',
        'POJ 登录已失效，请重新登录',
        false,
      );
    }
    // POJ 提交成功通常 302 到 /status 页面（由 fetch 自动跟随）
    if (status >= 400) {
      throw new AdapterError('PLATFORM_ERROR', `POJ 提交失败 HTTP ${status}`, false);
    }

    // 取 status 首行确认 runId
    const statusHtml = await this.api.fetchStatus({
      user_id: username,
      problem_id: pid,
    });
    const row = await parseStatusFirstRow(statusHtml, username ?? '', pid);
    if (!row) {
      throw new AdapterError('PLATFORM_ERROR', 'POJ 提交后未在状态页找到 runId', false);
    }
    return row.runId;
  }

  async pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult> {
    const cred = await this.deps.credentialStore.get(this.id);
    const username = cred?.extra?.username;
    const backoffs = [3000, 5000, 8000, 12_000];
    const totalTimeoutMs = 90_000;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < totalTimeoutMs) {
      // POJ 状态页用 top=<runId+1> 反向锚定到该提交
      const html = await this.api.fetchStatus({
        user_id: username,
        top: String(Number(sid) + 1),
      });
      const row = await parseStatusRowByRunId(html, sid);
      if (row && row.verdict !== 'JUDGING' && row.verdict !== 'PENDING') {
        return {
          submissionId: sid,
          verdict: row.verdict,
          timeMs: row.timeMs,
          memoryKb: row.memoryKb,
          message: row.rawStatus,
        };
      }
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)]!;
      attempt++;
      await sleep(delay);
    }

    throw new AdapterError('JUDGING_TIMEOUT', `POJ 评测超过 ${totalTimeoutMs}ms`, false);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
