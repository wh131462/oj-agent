/**
 * HDOJ 适配器。HTML 爬取 + GBK 表单提交。
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
} from '../adapter.js';
import type { RegistryDeps } from '../registry.js';
import {
  parseListPage,
  parseProblemPage,
  parseStatusFirstRow,
} from './html-parsers.js';

const BASE = 'http://acm.hdu.edu.cn';

const LANG_MAP: Record<string, number> = {
  cpp: 0, // G++
  c: 3,
  java: 5,
  python3: 11, // Python3
};

export class HDOJAdapter implements PlatformAdapter {
  readonly id = 'hdoj' as const;
  readonly capabilities: PlatformCapabilities = {
    listProblems: true,
    getProblem: true,
    submit: true,
    pollResult: true,
    autoLogin: false,
  };

  constructor(private readonly deps: RegistryDeps) {}

  async login(): Promise<PlatformCredential> {
    throw new AdapterError(
      'AUTH_REQUIRED',
      'HDOJ 登录由前端实现:请通过 UI 收集 PHPSESSID 后写入凭证仓库',
      false,
    );
  }

  async listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]> {
    const vol = Math.max(1, query.page ?? 1);
    const res = await this.deps.httpClient.request({
      url: `${BASE}/listproblem.php`,
      method: 'GET',
      query: { vol: String(vol) },
      responseEncoding: 'gbk',
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 15_000,
    });
    let items = await parseListPage(res.text, vol);
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      items = items.filter((p) => p.title.toLowerCase().includes(kw) || p.id.includes(kw));
    }
    if (query.pageSize) {
      items = items.slice(0, query.pageSize);
    }
    return items;
  }

  async getProblem(pid: string): Promise<PlatformProblemDetail> {
    const res = await this.deps.httpClient.request({
      url: `${BASE}/showproblem.php`,
      method: 'GET',
      query: { pid },
      responseEncoding: 'gbk',
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 15_000,
    });
    if (/No such problem/i.test(res.text)) {
      throw new AdapterError('NOT_FOUND', `HDOJ 题目不存在: ${pid}`, false);
    }
    return parseProblemPage(res.text, pid);
  }

  async submit(pid: string, lang: string, code: string): Promise<PlatformSubmissionId> {
    const cred = await this.deps.credentialStore.get(this.id);
    if (!cred?.cookie) {
      throw new AdapterError('AUTH_REQUIRED', '请先登录 HDOJ', false);
    }
    const langId = LANG_MAP[lang];
    if (langId === undefined) {
      throw new AdapterError('LANG_UNSUPPORTED', `HDOJ 不支持语言: ${lang}`, false);
    }
    const username = cred.extra?.username;

    await this.deps.httpClient.request({
      url: `${BASE}/submit.php`,
      method: 'POST',
      query: { action: 'submit' },
      contentType: 'form',
      formEncoding: 'gbk',
      body: {
        problemid: pid,
        language: String(langId),
        usercode: code,
        check: '0',
      },
      headers: {
        Referer: `${BASE}/submit.php?pid=${pid}`,
        Origin: BASE,
      },
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 15_000,
    });

    // HDOJ submit 成功通常 302 到 status.php?user=<u>;
    // 我们立刻取 status 首行确定 RunID(用首次轮询的初值)
    const first = await this.fetchStatusFirstRow(username, pid);
    if (!first) {
      throw new AdapterError('PLATFORM_ERROR', 'HDOJ 提交后未获取到 RunID', false);
    }
    return first.runId;
  }

  async pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult> {
    const cred = await this.deps.credentialStore.get(this.id);
    const username = cred?.extra?.username;
    const backoffs = [1000, 2000, 3000, 5000];
    const totalTimeoutMs = 60_000;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < totalTimeoutMs) {
      const row = await this.fetchStatusByRunId(username, sid);
      if (row && row.verdict !== 'JUDGING' && row.verdict !== 'PENDING') {
        let compileError: string | undefined;
        if (row.verdict === 'CE') {
          compileError = await this.fetchCompileError(sid).catch(() => undefined);
        }
        return {
          submissionId: sid,
          verdict: row.verdict,
          timeMs: row.timeMs,
          memoryKb: row.memoryKb,
          message: row.rawStatus,
          compileError,
        };
      }
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)]!;
      attempt++;
      await sleep(delay);
    }
    throw new AdapterError('JUDGING_TIMEOUT', `HDOJ 评测超过 ${totalTimeoutMs}ms`, false);
  }

  private async fetchStatusFirstRow(
    username: string | undefined,
    pid: string,
  ): Promise<Awaited<ReturnType<typeof parseStatusFirstRow>> | undefined> {
    const res = await this.deps.httpClient.request({
      url: `${BASE}/status.php`,
      method: 'GET',
      query: { user: username ?? '', pid, first: '', noprivate: '1' },
      responseEncoding: 'gbk',
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 10_000,
    });
    return parseStatusFirstRow(res.text, username ?? '', pid);
  }

  private async fetchStatusByRunId(
    username: string | undefined,
    runId: string,
  ): Promise<Awaited<ReturnType<typeof parseStatusFirstRow>> | undefined> {
    // status 页支持 first=<runId> 锚定特定一条
    const res = await this.deps.httpClient.request({
      url: `${BASE}/status.php`,
      method: 'GET',
      query: { user: username ?? '', first: runId, noprivate: '1' },
      responseEncoding: 'gbk',
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 10_000,
    });
    return parseStatusFirstRow(res.text, username ?? '', '');
  }

  private async fetchCompileError(runId: string): Promise<string> {
    const res = await this.deps.httpClient.request({
      url: `${BASE}/viewerror.php`,
      method: 'GET',
      query: { rid: runId },
      responseEncoding: 'gbk',
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 10_000,
    });
    // 抽取 <pre>...</pre>
    const m = res.text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    return (m?.[1] ?? '').trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
