/**
 * LeetCode CN 适配器。GraphQL 协议实现。
 */

import { AdapterError } from '../errors.js';
import type {
  PlatformAdapter,
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
import { LeetCodeCnGraphQLClient } from './graphql-client.js';
import { htmlToMarkdown } from './html-to-markdown.js';

const PROBLEM_LIST_QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    hasMore
    total
    questions {
      acRate
      difficulty
      frontendQuestionId
      paidOnly
      title
      titleCn
      titleSlug
      topicTags {
        name
        nameTranslated
        slug
      }
    }
  }
}`;

const QUESTION_DATA_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    translatedTitle
    content
    translatedContent
    difficulty
    exampleTestcases
    sampleTestCase
    metaData
    codeSnippets {
      lang
      langSlug
      code
    }
    topicTags {
      name
      nameTranslated
      slug
    }
    stats
  }
}`;

const SUBMIT_CHECK_PATH = (id: string) => `https://leetcode.cn/submissions/detail/${id}/check/`;

/** M1 静态语言映射:用户语言 -> LeetCode langSlug。 */
const LANG_MAP: Record<string, string> = {
  cpp: 'cpp',
  python3: 'python3',
  java: 'java',
  javascript: 'javascript',
};

interface ProblemMetaCache {
  questionId: string;
  titleSlug: string;
}

export class LeetCodeCnAdapter implements PlatformAdapter {
  readonly id = 'leetcode-cn' as const;
  private readonly gql: LeetCodeCnGraphQLClient;
  /** slug -> questionId 缓存,提交时使用 */
  private readonly metaCache = new Map<string, ProblemMetaCache>();

  constructor(private readonly deps: RegistryDeps) {
    this.gql = new LeetCodeCnGraphQLClient(deps.httpClient, deps.credentialStore);
  }

  async login(): Promise<PlatformCredential> {
    throw new AdapterError(
      'AUTH_REQUIRED',
      'LeetCode CN 登录由前端实现:请通过 UI 收集 LEETCODE_SESSION 与 csrftoken 后写入凭证仓库',
      false,
    );
  }

  async listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 50));
    const skip = (page - 1) * pageSize;
    const filters: Record<string, unknown> = {};
    if (query.keyword) filters.searchKeywords = query.keyword;
    if (query.difficulty) filters.difficulty = query.difficulty.toUpperCase();
    if (query.tags && query.tags.length > 0) filters.tags = query.tags;

    const data = await this.gql.exec<{
      problemsetQuestionList: {
        questions: Array<{
          frontendQuestionId: string;
          title: string;
          titleCn?: string;
          titleSlug: string;
          difficulty: string;
          topicTags?: Array<{ name: string; nameTranslated?: string; slug: string }>;
        }>;
      };
    }>({
      query: PROBLEM_LIST_QUERY,
      variables: {
        categorySlug: 'all-code-essentials',
        limit: pageSize,
        skip,
        filters,
      },
    });

    const list = data.problemsetQuestionList?.questions ?? [];
    return list.map((q) => ({
      platform: this.id,
      id: q.frontendQuestionId,
      title: q.titleCn || q.title,
      difficulty: normalizeDifficulty(q.difficulty),
      tags: (q.topicTags ?? []).map((t) => t.nameTranslated || t.name),
      url: `https://leetcode.cn/problems/${q.titleSlug}/`,
    }));
  }

  async getProblem(slugOrId: string): Promise<PlatformProblemDetail> {
    const data = await this.gql.exec<{
      question: {
        questionId: string;
        questionFrontendId: string;
        title: string;
        titleSlug: string;
        translatedTitle?: string;
        content?: string;
        translatedContent?: string;
        difficulty: string;
        exampleTestcases?: string;
        sampleTestCase?: string;
        metaData?: string;
        codeSnippets?: Array<{ lang: string; langSlug: string; code: string }>;
        topicTags?: Array<{ name: string; nameTranslated?: string; slug: string }>;
      };
    }>({
      query: QUESTION_DATA_QUERY,
      variables: { titleSlug: slugOrId },
    });

    const q = data.question;
    if (!q) {
      throw new AdapterError('NOT_FOUND', `题目不存在: ${slugOrId}`, false);
    }

    this.metaCache.set(q.titleSlug, {
      questionId: q.questionId,
      titleSlug: q.titleSlug,
    });

    const contentHtml = q.translatedContent || q.content || '';
    let statement: string;
    try {
      statement = await htmlToMarkdown(contentHtml);
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '题面 HTML 转 Markdown 失败', false, e);
    }

    const samples = this.extractSamples(q.exampleTestcases ?? q.sampleTestCase ?? '', q.metaData ?? '', contentHtml);
    const codeSnippets: Record<string, string> = {};
    for (const s of q.codeSnippets ?? []) {
      codeSnippets[s.langSlug] = s.code;
    }

    return {
      platform: this.id,
      id: q.questionFrontendId,
      title: q.translatedTitle || q.title,
      difficulty: normalizeDifficulty(q.difficulty),
      tags: (q.topicTags ?? []).map((t) => t.nameTranslated || t.name),
      url: `https://leetcode.cn/problems/${q.titleSlug}/`,
      statement,
      samples,
      codeSnippets,
    };
  }

  async submit(slugOrId: string, lang: string, code: string): Promise<PlatformSubmissionId> {
    const cred = await this.deps.credentialStore.get(this.id);
    if (!cred?.cookie) {
      throw new AdapterError('AUTH_REQUIRED', '请先登录 LeetCode CN', false);
    }

    const langSlug = LANG_MAP[lang];
    if (!langSlug) {
      throw new AdapterError('LANG_UNSUPPORTED', `LeetCode CN 不支持语言: ${lang}`, false);
    }

    // 需要 questionId,若缓存缺失则先 getProblem
    let meta = this.metaCache.get(slugOrId);
    if (!meta) {
      await this.getProblem(slugOrId);
      meta = this.metaCache.get(slugOrId);
    }
    if (!meta) {
      throw new AdapterError('NOT_FOUND', `题目元数据不可得: ${slugOrId}`, false);
    }

    const csrf = extractCsrf(cred.cookie);
    const headers: Record<string, string> = {
      Referer: `https://leetcode.cn/problems/${meta.titleSlug}/`,
      Origin: 'https://leetcode.cn',
      'Content-Type': 'application/json',
    };
    if (csrf) headers['X-CSRFToken'] = csrf;

    const res = await this.deps.httpClient.request({
      url: `https://leetcode.cn/problems/${meta.titleSlug}/submit/`,
      method: 'POST',
      headers,
      contentType: 'json',
      body: {
        lang: langSlug,
        question_id: meta.questionId,
        typed_code: code,
      },
      injectCookieFor: this.id,
      rateLimitKey: this.id,
      timeoutMs: 15_000,
    });

    let payload: { submission_id?: number | string };
    try {
      payload = res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '提交响应非 JSON', false, e);
    }
    if (payload.submission_id === undefined || payload.submission_id === null) {
      throw new AdapterError('PLATFORM_ERROR', '提交未返回 submission_id', false);
    }
    return String(payload.submission_id);
  }

  async pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult> {
    const backoffs = [1000, 2000, 3000, 5000];
    const totalTimeoutMs = 60_000;
    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < totalTimeoutMs) {
      const res = await this.deps.httpClient.request({
        url: SUBMIT_CHECK_PATH(sid),
        method: 'GET',
        injectCookieFor: this.id,
        rateLimitKey: this.id,
        timeoutMs: 8000,
        headers: {
          Referer: 'https://leetcode.cn/',
          Origin: 'https://leetcode.cn',
        },
      });

      let data: {
        state?: string;
        status_msg?: string;
        status_runtime?: string;
        status_memory?: string;
        total_correct?: number;
        total_testcases?: number;
        full_compile_error?: string;
        compile_error?: string;
        runtime_error?: string;
      };
      try {
        data = res.json();
      } catch (e) {
        throw new AdapterError('PARSE_ERROR', '轮询响应非 JSON', false, e);
      }

      if (data.state === 'SUCCESS') {
        const verdict = mapLeetCodeVerdict(data.status_msg ?? '');
        return {
          submissionId: sid,
          verdict,
          timeMs: parseRuntime(data.status_runtime),
          memoryKb: parseMemory(data.status_memory),
          passedCases: data.total_correct,
          totalCases: data.total_testcases,
          message: data.status_msg,
          compileError: data.full_compile_error || data.compile_error,
        };
      }

      // PENDING / STARTED -> 继续退避
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)]!;
      attempt++;
      await sleep(delay);
    }

    throw new AdapterError('JUDGING_TIMEOUT', `LeetCode CN 评测超过 ${totalTimeoutMs}ms`, false);
  }

  /**
   * 解析样例。优先 exampleTestcases(换行分隔字符串),按 metaData.params.length 切分;
   * 若为空降级从 HTML 中解析 "Example N" 块的 input/output。
   */
  private extractSamples(
    exampleTestcases: string,
    metaDataStr: string,
    contentHtml: string,
  ): PlatformSampleCase[] {
    if (exampleTestcases && exampleTestcases.trim().length > 0) {
      let paramCount = 1;
      try {
        const meta = JSON.parse(metaDataStr) as { params?: unknown[] };
        if (Array.isArray(meta?.params) && meta.params.length > 0) {
          paramCount = meta.params.length;
        }
      } catch {
        // 用默认 1
      }
      const lines = exampleTestcases.split('\n');
      const samples: PlatformSampleCase[] = [];
      for (let i = 0; i + paramCount <= lines.length; i += paramCount) {
        const input = lines.slice(i, i + paramCount).join('\n');
        samples.push({ input, output: '' });
      }
      if (samples.length > 0) return samples;
    }

    // 降级:尝试从 HTML 中扫 Example
    return parseSamplesFromContent(contentHtml);
  }
}

function normalizeDifficulty(d: string): string {
  const v = (d ?? '').toLowerCase();
  if (v === 'easy') return 'Easy';
  if (v === 'medium') return 'Medium';
  if (v === 'hard') return 'Hard';
  return d || 'Unknown';
}

function mapLeetCodeVerdict(statusMsg: string): PlatformVerdict {
  const m = statusMsg || '';
  if (/Accepted/i.test(m)) return 'AC';
  if (/Wrong Answer/i.test(m)) return 'WA';
  if (/Time Limit Exceeded/i.test(m)) return 'TLE';
  if (/Memory Limit Exceeded/i.test(m)) return 'MLE';
  if (/Compile Error/i.test(m)) return 'CE';
  if (/Runtime Error/i.test(m)) return 'RE';
  if (/Output Limit Exceeded/i.test(m)) return 'WA';
  return 'UNKNOWN';
}

function parseRuntime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function parseMemory(s: string | undefined): number | undefined {
  if (!s) return undefined;
  // LeetCode 返回 "1.4 MB" 等
  const m = s.match(/([\d.]+)\s*([KMG]B)?/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  const unit = (m[2] ?? 'KB').toUpperCase();
  if (unit === 'KB') return Math.round(v);
  if (unit === 'MB') return Math.round(v * 1024);
  if (unit === 'GB') return Math.round(v * 1024 * 1024);
  return Math.round(v);
}

function extractCsrf(cookie: string): string | undefined {
  const m = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? m[1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 从 HTML 中按 "Example N" 段抽取 sample。简易实现:匹配 <pre> 块的 input/output 文字。 */
function parseSamplesFromContent(html: string): PlatformSampleCase[] {
  const samples: PlatformSampleCase[] = [];
  if (!html) return samples;
  // 抓所有 <pre>...</pre> 块
  const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = preRegex.exec(html)) !== null) {
    blocks.push(stripTags(m[1]!));
  }
  for (const b of blocks) {
    const inputMatch = b.match(/(?:输入|Input)[:：]\s*([\s\S]*?)(?:(?:输出|Output)[:：]|$)/i);
    const outputMatch = b.match(/(?:输出|Output)[:：]\s*([\s\S]*?)(?:(?:解释|Explanation)[:：]|$)/i);
    const input = inputMatch ? inputMatch[1]!.trim() : '';
    const output = outputMatch ? outputMatch[1]!.trim() : '';
    if (input || output) samples.push({ input, output });
  }
  return samples;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}
