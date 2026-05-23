/**
 * 洛谷适配器。
 *
 * 数据来源：
 * - 列表 / 题面：解析页面内嵌 `<script id="lentille-context">` JSON
 * - 提交：POST /fe/api/problem/submit/{pid}，需 X-CSRF-Token
 * - 评测：轮询 /record/{rid}
 */

import { AdapterError } from '../errors.js';
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformCredential,
  PlatformListQuery,
  PlatformProblemDetail,
  PlatformProblemSummary,
  PlatformSampleCase,
  PlatformSubmissionId,
  PlatformJudgeResult,
  PlatformVerdict,
} from '../adapter.js';
import type { RegistryDeps } from '../registry.js';
import { LuoguApi } from './api.js';
import {
  assembleStatement,
  extractCsrfToken,
  extractLentilleContext,
  parseDetailContext,
  parseListContext,
} from './parse.js';
import { difficultyLabel, type LuoguProblemDetailRaw } from './types.js';

const BASE = 'https://www.luogu.com.cn';

/** 用户语言 -> 洛谷 lang id（参考洛谷题目提交页面）。 */
const LANG_MAP: Record<string, number> = {
  cpp: 4, // C++14 (GCC 9)
  c: 1, // C (GCC 9)
  java: 16, // Java 8
  python3: 25, // Python 3
  javascript: 22, // Node.js LTS
};

export class LuoguAdapter implements PlatformAdapter {
  readonly id = 'luogu' as const;
  readonly capabilities: PlatformCapabilities = {
    listProblems: true,
    getProblem: true,
    submit: true,
    pollResult: true,
    autoLogin: false,
  };

  private readonly api: LuoguApi;

  constructor(private readonly deps: RegistryDeps) {
    this.api = new LuoguApi(deps.httpClient);
  }

  async login(): Promise<PlatformCredential> {
    throw new AdapterError(
      'AUTH_REQUIRED',
      '洛谷登录由前端实现：请通过浏览器登录后将 Cookie 写入凭证仓库',
      false,
    );
  }

  async listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]> {
    const page = Math.max(1, query.page ?? 1);
    const html = await this.api.fetchProblemListHtml(page);
    const ctx = extractLentilleContext(html);
    const problems = parseListContext(ctx);
    if (!problems) {
      throw new AdapterError('PARSE_ERROR', '洛谷题目列表解析为空', false);
    }

    let items: PlatformProblemSummary[] = problems.result.map((p) => ({
      platform: this.id,
      id: p.pid,
      title: p.name ?? p.title ?? p.pid,
      difficulty: difficultyLabel(p.difficulty),
      tags: (p.tags ?? []).map(String),
      url: `${BASE}/problem/${p.pid}`,
    }));

    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      items = items.filter(
        (p) => p.title.toLowerCase().includes(kw) || p.id.toLowerCase().includes(kw),
      );
    }
    if (query.difficulty) {
      const d = query.difficulty;
      items = items.filter((p) => p.difficulty === d);
    }
    const pageSize = query.pageSize;
    if (pageSize) items = items.slice(0, pageSize);
    return items;
  }

  async getProblem(pid: string): Promise<PlatformProblemDetail> {
    const html = await this.api.fetchProblemDetailHtml(pid);
    const ctx = extractLentilleContext(html);
    const raw = parseDetailContext(ctx);

    return {
      platform: this.id,
      id: raw.pid,
      title: raw.name ?? raw.title ?? raw.pid,
      difficulty: difficultyLabel(raw.difficulty),
      tags: (raw.tags ?? []).map(String),
      url: `${BASE}/problem/${raw.pid}`,
      statement: assembleStatement(raw),
      samples: extractSamples(raw),
      ...buildLimits(raw),
    };
  }

  async submit(
    pid: string,
    lang: string,
    code: string,
  ): Promise<PlatformSubmissionId> {
    const cred = await this.deps.credentialStore.get(this.id);
    if (!cred?.cookie) {
      throw new AdapterError('AUTH_REQUIRED', '请先登录洛谷', false);
    }
    const langId = LANG_MAP[lang];
    if (langId === undefined) {
      throw new AdapterError('LANG_UNSUPPORTED', `洛谷不支持语言: ${lang}`, false);
    }

    // 题目详情页拿 CSRF token
    const detailHtml = await this.api.fetchProblemDetailHtml(pid);
    const csrf = extractCsrfToken(detailHtml);
    if (!csrf) {
      throw new AdapterError(
        'AUTH_REQUIRED',
        '洛谷详情页未找到 csrf-token，请重新登录',
        false,
      );
    }

    const result = await this.api.submit(
      pid,
      { lang: langId, code, enableO2: 0 },
      csrf,
    );
    const rid = result.rid ?? result.id;
    if (rid === undefined) {
      throw new AdapterError('PLATFORM_ERROR', '洛谷提交未返回 record id', false);
    }
    return String(rid);
  }

  async pollResult(rid: PlatformSubmissionId): Promise<PlatformJudgeResult> {
    const backoffs = [2000, 3000, 5000, 8000];
    const totalTimeoutMs = 90_000;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < totalTimeoutMs) {
      const html = await this.api.fetchRecordHtml(rid);
      let record: LuoguRecordRaw | undefined;
      try {
        const ctx = extractLentilleContext(html) as { data?: { record?: LuoguRecordRaw } };
        record = ctx?.data?.record;
      } catch (e) {
        // 解析失败，再退避一次
        if (attempt + 1 >= backoffs.length) throw e;
      }
      if (record && record.status !== undefined && !isJudgingStatus(record.status)) {
        return {
          submissionId: rid,
          verdict: mapLuoguStatus(record.status),
          timeMs: record.time,
          memoryKb: record.memory,
          message: record.detail?.compileResult?.message,
          compileError: record.detail?.compileResult?.message,
        };
      }
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)]!;
      attempt++;
      await sleep(delay);
    }

    throw new AdapterError('JUDGING_TIMEOUT', `洛谷评测超过 ${totalTimeoutMs}ms`, false);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

interface LuoguRecordRaw {
  /**
   * 洛谷状态码：
   *  0 等待
   *  1 评测中
   *  2 编译错误
   *  4 测试点错误（WA / TLE / MLE / RE 视细节）
   *  6 部分得分
   *  7 完全正确
   *  ...
   */
  status?: number;
  time?: number;
  memory?: number;
  detail?: {
    compileResult?: { success?: boolean; message?: string };
  };
}

function isJudgingStatus(status: number): boolean {
  return status === 0 || status === 1;
}

function mapLuoguStatus(status: number): PlatformVerdict {
  switch (status) {
    case 7:
      return 'AC';
    case 2:
      return 'CE';
    case 4:
      return 'WA';
    case 6:
      return 'WA'; // 部分得分按未通过处理
    default:
      return 'UNKNOWN';
  }
}

function extractSamples(raw: LuoguProblemDetailRaw): PlatformSampleCase[] {
  if (Array.isArray(raw.samples) && raw.samples.length > 0) {
    return raw.samples.map(([input, output]) => ({
      input: input ?? '',
      output: output ?? '',
    }));
  }
  return [];
}

function buildLimits(
  raw: LuoguProblemDetailRaw,
): { timeLimitMs?: number; memoryLimitKb?: number } {
  const out: { timeLimitMs?: number; memoryLimitKb?: number } = {};
  if (raw.limits?.time && raw.limits.time.length > 0) {
    out.timeLimitMs = Math.max(...raw.limits.time);
  }
  if (raw.limits?.memory && raw.limits.memory.length > 0) {
    out.memoryLimitKb = Math.max(...raw.limits.memory);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
