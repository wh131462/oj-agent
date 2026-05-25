/**
 * 蓝桥云课适配器。
 *
 * 能力降级：
 * - listProblems：公开 API（list 仅返回 id/tags/difficulty，title 需要详情补全）
 * - getProblem / submit / pollResult：需要 JWT；缺失或 401/403 时抛 AUTH_REQUIRED
 */

import { AdapterError } from '../errors.js';
import type {
  PlatformAdapter,
  PlatformCapabilities,
  PlatformCredential,
  PlatformDegradedInfo,
  PlatformListQuery,
  PlatformProblemDetail,
  PlatformProblemSummary,
  PlatformSampleCase,
  PlatformSubmissionId,
  PlatformJudgeResult,
  PlatformVerdict,
} from '../adapter.js';
import type { RegistryDeps } from '../registry.js';
import { LanqiaoApi } from './api.js';
import { difficultyLabel, type LanqiaoProblemDetailRaw } from './types.js';

const BASE = 'https://www.lanqiao.cn';

const LANG_MAP: Record<string, string> = {
  cpp: 'cpp',
  c: 'c',
  java: 'java',
  python3: 'python3',
  javascript: 'javascript',
};

export class LanqiaoAdapter implements PlatformAdapter {
  readonly id = 'lanqiao' as const;
  readonly capabilities: PlatformCapabilities = {
    listProblems: true,
    getProblem: true,
    submit: true,
    pollResult: true,
    autoLogin: false,
  };
  readonly degraded: PlatformDegradedInfo[] = [
    {
      capability: 'listProblems',
      reason: '蓝桥云课 /api/v2/problems/ 公开接口仅返回 id 与 tags，title 等元数据需要登录后逐题取详情。',
      hint: '未登录时列表仅展示题号；登录后会按需补全标题。',
    },
    {
      capability: 'getProblem',
      reason: '题目详情需 JWT 认证，未登录将返回 401。',
      hint: '请先登录蓝桥云课。',
    },
    {
      capability: 'submit',
      reason: '蓝桥云课主推在线 IDE，本地提交端点未公开文档；提交需 JWT。',
      hint: '提交失败时建议在网页端 IDE 完成提交。',
    },
  ];

  private readonly api: LanqiaoApi;

  constructor(private readonly deps: RegistryDeps) {
    this.api = new LanqiaoApi(deps.httpClient);
  }

  async login(): Promise<PlatformCredential> {
    throw new AdapterError(
      'AUTH_REQUIRED',
      '蓝桥云课登录由前端实现：请通过浏览器在 passport.lanqiao.cn 登录后将 JWT 写入凭证仓库（extra.token）',
      false,
    );
  }

  async listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]> {
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 50));
    const page = Math.max(1, query.page ?? 1);
    const offset = (page - 1) * pageSize;
    const cred = await this.deps.credentialStore.get(this.id);
    const jwt = cred?.token ?? cred?.extra?.token;

    const data = await this.api.listProblems({ page_size: pageSize, page }, jwt);
    let items: PlatformProblemSummary[] = (data.data ?? []).map((p) => ({
      platform: this.id,
      id: String(p.id),
      title: p.name ?? p.title ?? `蓝桥 #${p.id}`,
      difficulty: difficultyLabel(p.difficulty_level ?? p.difficulty),
      tags: p.tags ?? [],
      url: `${BASE}/problems/${p.id}/learning/`,
    }));

    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      items = items.filter(
        (p) => p.title.toLowerCase().includes(kw) || p.id.includes(kw),
      );
    }
    return items;
  }

  async getProblem(id: string): Promise<PlatformProblemDetail> {
    const jwt = await this.requireJwt('查看题目详情');
    let raw: LanqiaoProblemDetailRaw;
    try {
      raw = await this.api.getProblem(id, jwt);
    } catch (e) {
      if (e instanceof AdapterError && (e.code === 'AUTH_REQUIRED' || e.code === 'AUTH_EXPIRED')) {
        throw e;
      }
      throw e;
    }

    const samples: PlatformSampleCase[] = (raw.examples ?? []).map((s) => ({
      input: s.input ?? '',
      output: s.output ?? '',
    }));

    const sections: string[] = [];
    if (raw.description) sections.push(`## 题目描述\n\n${raw.description}`);
    if (raw.input) sections.push(`## 输入格式\n\n${raw.input}`);
    if (raw.output) sections.push(`## 输出格式\n\n${raw.output}`);
    if (raw.hint) sections.push(`## 提示\n\n${raw.hint}`);

    return {
      platform: this.id,
      id: String(raw.id),
      title: raw.title ?? `蓝桥 #${raw.id}`,
      difficulty: difficultyLabel(raw.difficulty),
      tags: raw.tags ?? [],
      url: `${BASE}/problems/${raw.id}/learning/`,
      statement: sections.join('\n\n'),
      samples,
      ...(raw.time_limit !== undefined ? { timeLimitMs: raw.time_limit } : {}),
      ...(raw.memory_limit !== undefined ? { memoryLimitKb: raw.memory_limit } : {}),
    };
  }

  async submit(
    id: string,
    lang: string,
    code: string,
  ): Promise<PlatformSubmissionId> {
    const jwt = await this.requireJwt('提交代码');
    const language = LANG_MAP[lang];
    if (!language) {
      throw new AdapterError('LANG_UNSUPPORTED', `蓝桥云课不支持语言: ${lang}`, false);
    }
    const result = await this.api.submit(id, { language, code }, jwt);
    const sid = result.submission_id ?? result.id;
    if (sid === undefined || sid === null) {
      throw new AdapterError('PLATFORM_ERROR', '蓝桥云课提交未返回 submission id', false);
    }
    return String(sid);
  }

  async pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult> {
    const jwt = await this.requireJwt('查询提交结果');
    const backoffs = [2000, 3000, 5000, 8000];
    const totalTimeoutMs = 90_000;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < totalTimeoutMs) {
      const data = (await this.api.getSubmission(sid, jwt)) as {
        status?: string | number;
        verdict?: string | number;
        time_used?: number;
        memory_used?: number;
        compile_log?: string;
        message?: string;
      };
      const verdictRaw = String(data.verdict ?? data.status ?? '');
      if (verdictRaw && !isJudging(verdictRaw)) {
        return {
          submissionId: sid,
          verdict: mapLanqiaoVerdict(verdictRaw),
          timeMs: data.time_used,
          memoryKb: data.memory_used,
          message: data.message,
          compileError: data.compile_log,
        };
      }
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)]!;
      attempt++;
      await sleep(delay);
    }

    throw new AdapterError('JUDGING_TIMEOUT', `蓝桥云课评测超过 ${totalTimeoutMs}ms`, false);
  }

  /** 取 JWT；缺失立即抛 AUTH_REQUIRED。 */
  private async requireJwt(action: string): Promise<string> {
    const cred = await this.deps.credentialStore.get(this.id);
    // JWT 可能存储在 token、extra.token 或 cookie 中的 lqtoken
    let jwt = cred?.token ?? cred?.extra?.token;
    if (!jwt && cred?.cookie) {
      // 从 cookie 中提取 lqtoken
      const m = cred.cookie.match(/(?:^|;\s*)lqtoken=([^;]+)/);
      if (m) jwt = m[1];
    }
    if (!jwt) {
      throw new AdapterError(
        'AUTH_REQUIRED',
        `${action}需要登录蓝桥云课（缺少 JWT）`,
        false,
      );
    }
    return jwt;
  }
}

function isJudging(s: string): boolean {
  const v = s.toLowerCase();
  return (
    v === 'pending' ||
    v === 'judging' ||
    v === 'running' ||
    v === 'queued' ||
    v === 'compiling' ||
    v === '0'
  );
}

function mapLanqiaoVerdict(s: string): PlatformVerdict {
  const v = s.toLowerCase();
  if (v.includes('accept') || v === 'ac' || v === 'success') return 'AC';
  if (v.includes('wrong') || v === 'wa') return 'WA';
  if (v.includes('time') || v === 'tle') return 'TLE';
  if (v.includes('memory') || v === 'mle') return 'MLE';
  if (v.includes('runtime') || v === 're') return 'RE';
  if (v.includes('compile') || v === 'ce') return 'CE';
  if (v.includes('presentation') || v === 'pe') return 'PE';
  return 'UNKNOWN';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
