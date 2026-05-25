/**
 * Codeforces 适配器。
 * - 题目列表：官方 REST API（无需认证）
 * - 题面正文：通过已登录会话取 HTML，解析 .problem-statement
 * - 提交/轮询：需登录 cookie
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
  PlatformVerdict,
  ProblemLangInfo,
} from '../adapter.js';
import type { RegistryDeps } from '../registry.js';
import { CodeforcesApi } from './api.js';
import { parseCodeforcesProblem, buildProblemDetail } from './parse.js';
import { parseCfProblemId, ratingToDifficulty } from './types.js';
import { withSession } from '../../http/session.js';

const BASE = 'https://codeforces.com';

/** 语言映射：用户 lang -> Codeforces programTypeId */
const LANG_MAP: Record<string, number> = {
  cpp: 54, // GNU G++17 7.3.0
  c: 43, // GNU GCC C11 5.1.0
  java: 60, // Java 11 64bit
  python3: 70, // PyPy 3.7
  javascript: 34, // JavaScript V8
};

/** UI 展示名（getProblemLangs 用），值与 LANG_MAP 的注释保持一致以便用户分辨编译器版本。 */
const LANG_DISPLAY: Record<string, string> = {
  cpp: 'GNU G++17',
  c: 'GNU GCC C11',
  java: 'Java 11',
  python3: 'PyPy 3.7',
  javascript: 'JavaScript V8',
};

export class CodeforcesAdapter implements PlatformAdapter {
  readonly id = 'codeforces' as const;
  readonly capabilities: PlatformCapabilities = {
    listProblems: true,
    getProblem: true,
    submit: true,
    pollResult: true,
    autoLogin: false,
  };
  readonly supportedLangs: readonly string[] = Object.keys(LANG_MAP);

  private readonly api: CodeforcesApi;
  /** rating 与 tags 元数据缓存（避免每次 getProblem 都拉一次 problemset） */
  private metaCache?: Map<string, { rating?: number; tags: string[] }>;

  constructor(private readonly deps: RegistryDeps) {
    this.api = new CodeforcesApi(deps.httpClient);
  }

  async login(): Promise<PlatformCredential> {
    throw new AdapterError(
      'AUTH_REQUIRED',
      'Codeforces 登录由前端实现：请通过浏览器登录后将 Cookie 写入凭证仓库',
      false,
    );
  }

  async listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]> {
    const body = await this.api.problemset({ tags: query.tags });
    const result = body.result!;
    const cache = this.ensureMetaCache();
    let items: PlatformProblemSummary[] = result.problems.map((p) => {
      const id = `${p.contestId}${p.index}`;
      cache.set(id, { rating: p.rating, tags: p.tags ?? [] });
      return {
        platform: this.id,
        id,
        title: p.name,
        difficulty: ratingToDifficulty(p.rating),
        tags: p.tags ?? [],
        url: `${BASE}/problemset/problem/${p.contestId}/${p.index}`,
      };
    });

    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      items = items.filter(
        (p) => p.title.toLowerCase().includes(kw) || p.id.toLowerCase().includes(kw),
      );
    }
    if (query.difficulty) {
      const d = query.difficulty.toLowerCase();
      items = items.filter((p) => p.difficulty?.toLowerCase() === d);
    }

    const pageSize = query.pageSize ?? 50;
    const page = Math.max(1, query.page ?? 1);
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  async getProblem(problemId: string): Promise<PlatformProblemDetail> {
    const parsed = parseCfProblemId(problemId);
    if (!parsed) {
      throw new AdapterError('NOT_FOUND', `无效的 Codeforces 题目 ID: ${problemId}`, false);
    }
    const { contestId, index } = parsed;

    const html = await this.api.fetchProblemHtml(contestId, index);
    const detail = await parseCodeforcesProblem(html);

    // 元数据：优先从 cache，缓存缺失时按需补一次
    let meta = this.metaCache?.get(problemId);
    if (!meta) {
      try {
        await this.listProblems({});
        meta = this.metaCache?.get(problemId);
      } catch {
        // 元数据补全失败不影响题面返回
      }
    }

    return buildProblemDetail(
      problemId,
      contestId,
      index,
      detail,
      ratingToDifficulty(meta?.rating),
      meta?.tags,
    );
  }

  /**
   * Codeforces 平台级语言列表对所有题一致；直接由静态 LANG_MAP 包装返回。
   * 提交时这些 platformLangId 会绕过 LANG_MAP 直传 programTypeId。
   */
  async getProblemLangs(_problemId: string): Promise<ProblemLangInfo[]> {
    return Object.entries(LANG_MAP).map(([lang, id]) => ({
      lang,
      displayName: LANG_DISPLAY[lang] ?? lang,
      platformLangId: String(id),
    }));
  }

  async submit(
    problemId: string,
    lang: string,
    code: string,
    platformLangId?: string,
  ): Promise<PlatformSubmissionId> {
    const parsed = parseCfProblemId(problemId);
    if (!parsed) {
      throw new AdapterError('NOT_FOUND', `无效的 Codeforces 题目 ID: ${problemId}`, false);
    }
    const cred = await this.deps.credentialStore.get(this.id);
    if (!cred?.cookie) {
      throw new AdapterError('AUTH_REQUIRED', '请先登录 Codeforces', false);
    }
    const programTypeIdRaw = platformLangId ?? (LANG_MAP[lang] !== undefined ? String(LANG_MAP[lang]) : undefined);
    if (programTypeIdRaw === undefined) {
      throw new AdapterError('LANG_UNSUPPORTED', `Codeforces 不支持语言: ${lang}`, false);
    }

    // 取提交页拿 CSRF token
    const submitPage = await this.api.fetchSubmitPageHtml(parsed.contestId);
    const csrf = extractCsrfToken(submitPage);
    if (!csrf) {
      throw new AdapterError(
        'AUTH_REQUIRED',
        'Codeforces 提交页缺少 CSRF token，请重新登录',
        false,
      );
    }

    await this.api.submit(parsed.contestId, {
      csrf_token: csrf,
      action: 'submitSolutionFormSubmit',
      submittedProblemIndex: parsed.index,
      programTypeId: programTypeIdRaw,
      source: code,
      tabSize: '4',
      sourceFile: '',
    });

    // 取最近一次提交的 ID（user.status）
    const handle = cred.extra?.handle ?? cred.extra?.username;
    if (!handle) {
      // 没有 handle 时返回兜底 ID，pollResult 会引导用户去 my-submissions
      return `cf:${parsed.contestId}:${parsed.index}`;
    }
    const recent = (await this.api.userStatus(handle, 5)) as {
      status: string;
      result?: Array<{ id: number; problem?: { contestId: number; index: string } }>;
    };
    const sub = recent.result?.find(
      (s) => s.problem?.contestId === parsed.contestId && s.problem?.index === parsed.index,
    );
    if (!sub) {
      return `cf:${parsed.contestId}:${parsed.index}`;
    }
    return String(sub.id);
  }

  async pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult> {
    // 兜底 ID：无 handle，无法轮询，引导用户打开提交页
    if (sid.startsWith('cf:')) {
      const parts = sid.split(':');
      const contestId = parts[1] ?? '';
      return {
        submissionId: sid,
        verdict: 'UNKNOWN',
        message: `Codeforces 未配置 handle，请前往 ${BASE}/contest/${contestId}/my-submissions 查看结果`,
      };
    }

    const cred = await this.deps.credentialStore.get(this.id);
    const handle = cred?.extra?.handle ?? cred?.extra?.username;
    if (!handle) {
      return {
        submissionId: sid,
        verdict: 'UNKNOWN',
        message: 'Codeforces 凭证缺少 handle，无法轮询',
      };
    }

    const backoffs = [2000, 3000, 5000, 8000];
    const totalTimeoutMs = 90_000;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < totalTimeoutMs) {
      const data = (await this.api.userStatus(handle, 10)) as {
        status: string;
        result?: Array<{
          id: number;
          verdict?: string;
          timeConsumedMillis?: number;
          memoryConsumedBytes?: number;
          passedTestCount?: number;
        }>;
      };
      if (data.status === 'OK' && data.result) {
        const sub = data.result.find((s) => String(s.id) === sid);
        if (sub && sub.verdict && sub.verdict !== 'TESTING') {
          return {
            submissionId: sid,
            verdict: mapCFVerdict(sub.verdict),
            timeMs: sub.timeConsumedMillis,
            memoryKb:
              sub.memoryConsumedBytes !== undefined
                ? Math.round(sub.memoryConsumedBytes / 1024)
                : undefined,
            passedCases: sub.passedTestCount,
            message: sub.verdict,
          };
        }
      }
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)]!;
      attempt++;
      await sleep(delay);
    }

    throw new AdapterError('JUDGING_TIMEOUT', `Codeforces 评测超过 ${totalTimeoutMs}ms`, false);
  }

  private ensureMetaCache(): Map<string, { rating?: number; tags: string[] }> {
    if (!this.metaCache) this.metaCache = new Map();
    return this.metaCache;
  }
}

function extractCsrfToken(html: string): string | undefined {
  // CF 模板：<meta name="X-Csrf-Token" content="abc"> 或 input[name="csrf_token"]
  const m1 = html.match(/<meta\s+name="X-Csrf-Token"\s+content="([^"]+)"/i);
  if (m1) return m1[1];
  const m2 = html.match(/name="csrf_token"[^>]*value="([^"]+)"/i);
  if (m2) return m2[1];
  return undefined;
}

function mapCFVerdict(v: string): PlatformVerdict {
  if (v === 'OK') return 'AC';
  if (v === 'WRONG_ANSWER') return 'WA';
  if (v === 'TIME_LIMIT_EXCEEDED') return 'TLE';
  if (v === 'MEMORY_LIMIT_EXCEEDED') return 'MLE';
  if (v === 'RUNTIME_ERROR') return 'RE';
  if (v === 'COMPILATION_ERROR') return 'CE';
  if (v === 'PRESENTATION_ERROR') return 'PE';
  if (v === 'TESTING' || v === 'SUBMITTED') return 'JUDGING';
  return 'UNKNOWN';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
