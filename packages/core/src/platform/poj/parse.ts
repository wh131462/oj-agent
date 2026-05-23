/**
 * POJ HTML 解析。所有 html 已由 HttpClient 完成 GBK -> UTF-16 解码。
 */

import { AdapterError } from '../errors.js';
import { loadCheerio } from '../hdoj/cheerio-loader.js';
import type {
  PlatformProblemDetail,
  PlatformProblemSummary,
  PlatformSampleCase,
  PlatformVerdict,
} from '../adapter.js';
import type { PojListRow, PojStatusRow } from './types.js';

const BASE = 'http://poj.org';

export async function parseListPage(html: string): Promise<PlatformProblemSummary[]> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);

  const items: PlatformProblemSummary[] = [];
  // POJ /problemlist 的题目表为 class="a"，行结构：
  // <tr><td>id</td><td><a href="problem?id=1000">title</a></td><td>ratio</td>...</tr>
  const rows = $('table tr').toArray();
  for (const tr of rows) {
    const tds = $(tr).find('td');
    if (tds.length < 3) continue;
    const idText = $(tds[1]).text().trim();
    if (!/^\d+$/.test(idText)) continue;
    const titleEl = $(tds[2]).find('a');
    const title = titleEl.text().trim();
    if (!title) continue;
    items.push({
      platform: 'poj',
      id: idText,
      title,
      url: `${BASE}/problem?id=${idText}`,
    });
  }
  return items;
}

export async function parseProblemPage(html: string, pid: string): Promise<PlatformProblemDetail> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);

  // 标题：<div class="ptt">Title</div>
  const title = $('.ptt').first().text().trim() || `Problem ${pid}`;

  // POJ 区段标识用 `<p class="pst">Description</p>` 紧跟 `<div class="ptx">...</div>`
  // Sample Input / Sample Output 用 `<pre class="sio">...</pre>`
  const sections: Array<{ name: string; html: string }> = [];
  const sampleInputs: string[] = [];
  const sampleOutputs: string[] = [];

  const pageHtml = $.html();
  const reSection =
    /<p\s+class=["']pst["'][^>]*>([^<]+)<\/p>\s*(?:<(?:div|pre)[^>]*class=["']?(ptx|sio)["']?[^>]*>([\s\S]*?)<\/(?:div|pre)>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = reSection.exec(pageHtml)) !== null) {
    const sec = m[1]!.trim();
    const klass = m[2];
    const content = m[3] ?? '';
    if (/Sample\s*Input/i.test(sec) && klass === 'sio') {
      sampleInputs.push(decodeHtml(stripTags(content)));
    } else if (/Sample\s*Output/i.test(sec) && klass === 'sio') {
      sampleOutputs.push(decodeHtml(stripTags(content)));
    } else {
      sections.push({ name: sec, html: content });
    }
  }

  if (sections.length === 0 && sampleInputs.length === 0) {
    throw new AdapterError('PARSE_ERROR', 'POJ 题面解析失败：未找到 pst 段', false);
  }

  const samples: PlatformSampleCase[] = [];
  for (let i = 0; i < Math.max(sampleInputs.length, sampleOutputs.length); i++) {
    samples.push({
      input: sampleInputs[i] ?? '',
      output: sampleOutputs[i] ?? '',
    });
  }

  const parts: string[] = [];
  for (const s of sections) {
    const md = htmlSectionToMarkdown(s.html);
    if (md.trim().length === 0) continue;
    parts.push(`### ${s.name}\n\n${md.trim()}\n`);
  }
  const statement = parts.join('\n');

  // 限制：顶部表格含 "Time Limit:" 与 "Memory Limit:"
  const limitMatch = pageHtml.match(
    /Time\s*Limit:\s*<\/b>\s*([\d.]+)MS[\s\S]*?Memory\s*Limit:\s*<\/b>\s*(\d+)K/i,
  );
  let timeLimitMs: number | undefined;
  let memoryLimitKb: number | undefined;
  if (limitMatch) {
    timeLimitMs = Math.round(Number(limitMatch[1]));
    memoryLimitKb = Number(limitMatch[2]);
  }

  return {
    platform: 'poj',
    id: pid,
    title,
    url: `${BASE}/problem?id=${pid}`,
    statement,
    samples,
    ...(timeLimitMs !== undefined ? { timeLimitMs } : {}),
    ...(memoryLimitKb !== undefined ? { memoryLimitKb } : {}),
  };
}

export async function parseStatusRowByRunId(
  html: string,
  runId: string,
): Promise<PojStatusRow | undefined> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);
  const rows = $('table.a tr, table tr').toArray();
  for (const tr of rows) {
    const tds = $(tr).find('td');
    if (tds.length < 8) continue;
    const id = $(tds[0]).text().trim();
    if (id !== runId) continue;
    const user = $(tds[1]).text().trim();
    const problem = $(tds[2]).text().trim();
    const rawStatus = $(tds[3]).text().trim();
    const memoryStr = $(tds[4]).text().trim();
    const timeStr = $(tds[5]).text().trim();
    const language = $(tds[6]).text().trim();
    return {
      runId: id,
      user,
      problem,
      verdict: mapPojVerdict(rawStatus),
      rawStatus,
      language,
      memoryKb: parseIntOrUndef(memoryStr),
      timeMs: parseIntOrUndef(timeStr),
    };
  }
  return undefined;
}

export async function parseStatusFirstRow(
  html: string,
  user: string,
  problem: string,
): Promise<PojStatusRow | undefined> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);
  const rows = $('table.a tr, table tr').toArray();
  for (const tr of rows) {
    const tds = $(tr).find('td');
    if (tds.length < 8) continue;
    const runId = $(tds[0]).text().trim();
    if (!/^\d+$/.test(runId)) continue;
    const u = $(tds[1]).text().trim();
    const p = $(tds[2]).text().trim();
    if (user && u !== user) continue;
    if (problem && p !== problem) continue;
    return {
      runId,
      user: u,
      problem: p,
      verdict: mapPojVerdict($(tds[3]).text().trim()),
      rawStatus: $(tds[3]).text().trim(),
      memoryKb: parseIntOrUndef($(tds[4]).text().trim()),
      timeMs: parseIntOrUndef($(tds[5]).text().trim()),
      language: $(tds[6]).text().trim(),
    };
  }
  return undefined;
}

function mapPojVerdict(raw: string): PlatformVerdict {
  const s = raw.toLowerCase();
  if (s.includes('accepted')) return 'AC';
  if (s.includes('wrong answer')) return 'WA';
  if (s.includes('time limit')) return 'TLE';
  if (s.includes('memory limit')) return 'MLE';
  if (s.includes('runtime error')) return 'RE';
  if (s.includes('compile error')) return 'CE';
  if (s.includes('presentation error')) return 'PE';
  if (s.includes('output limit')) return 'WA';
  if (s.includes('queuing') || s.includes('compiling') || s.includes('running')) return 'JUDGING';
  if (s.includes('waiting')) return 'PENDING';
  return 'UNKNOWN';
}

function parseIntOrUndef(s: string): number | undefined {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlSectionToMarkdown(html: string): string {
  // 极简：把 <br> 转换为换行；其它 tag 直接剥离
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

export function isLoginPage(html: string): boolean {
  // POJ 未登录访问受限页面会跳转到 /login.php
  return /<form[^>]+action=["']?login["']?/i.test(html) && /user_id1/i.test(html);
}

// 测试辅助：标识在 listProblems 时仅取主题目表（避免 navigation/分页器误识别）
export function _filterIdRows(rows: PojListRow[]): PojListRow[] {
  return rows.filter((r) => /^\d+$/.test(r.id));
}
