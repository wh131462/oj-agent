/**
 * HDOJ HTML 解析。所有 html 参数必须已经过 HttpClient 的 GBK -> UTF-16 解码。
 */

import { AdapterError } from '../errors.js';
import { loadCheerio } from './cheerio-loader.js';
import type {
  PlatformProblemSummary,
  PlatformProblemDetail,
  PlatformSampleCase,
  PlatformVerdict,
} from '../adapter.js';

export interface HdojStatusRow {
  runId: string;
  verdict: PlatformVerdict;
  /** 平台原始状态文字,便于上层显示 */
  rawStatus: string;
  timeMs?: number;
  memoryKb?: number;
  language?: string;
}

export async function parseListPage(html: string, volume: number): Promise<PlatformProblemSummary[]> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);
  const items: PlatformProblemSummary[] = [];

  // 列表用嵌入的 JS 数组 `p(...);` 渲染;先尝试解析 JS 调用,失败再走 table 兜底
  const scripts = $('script')
    .map((_, el) => $(el).text())
    .get();
  for (const sc of scripts) {
    // 形如:p(<color>,<pid>,<solved>,"<title>",<ac>,<sub>); solved 可为 -1
    const re = /p\(-?\d+,(\d+),-?\d+,"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sc)) !== null) {
      const id = m[1]!;
      const title = decodeHtml(m[2]!);
      items.push({
        platform: 'hdoj',
        id,
        title,
        url: `http://acm.hdu.edu.cn/showproblem.php?pid=${id}`,
      });
    }
  }
  if (items.length > 0) return items;

  // 兜底:扫表格 tr
  const rows = $('table tr').toArray();
  for (const tr of rows) {
    const tds = $(tr).find('td');
    if (tds.length < 5) continue;
    const idText = $(tds[1]).text().trim();
    if (!/^\d+$/.test(idText)) continue;
    const titleEl = $(tds[3]).find('a');
    const title = titleEl.text().trim();
    if (!title) continue;
    items.push({
      platform: 'hdoj',
      id: idText,
      title,
      url: `http://acm.hdu.edu.cn/showproblem.php?pid=${idText}`,
    });
  }
  // volume 仅作为日志/未来分页索引使用,这里保留��数避免被 lint 误删
  void volume;
  return items;
}

export async function parseProblemPage(html: string, pid: string): Promise<PlatformProblemDetail> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);

  // 题目标题:页面通常用 `<h1 style="color:#1A5CC8">Title</h1>`
  const title =
    $('h1').first().text().trim() ||
    $('.h1, #h1').first().text().trim() ||
    `Problem ${pid}`;

  // HDOJ 题面区段标识由 <div class="panel_title"> 包裹("Problem Description"、"Input"、"Output" 等)
  const sections = new Map<string, string>();
  const samples: PlatformSampleCase[] = [];
  let currentSection: string | null = null;
  let sampleInputs: string[] = [];
  let sampleOutputs: string[] = [];

  // 兜底:整页扫 panel_title + 紧随 panel_content
  const body = $('body');
  const html2 = body.html() ?? html;
  // 按 panel_title 切分
  const reSection =
    /<div\s+class=["']panel_title[^>]*>([^<]+)<\/div>\s*(?:<div\s+class=["']panel_content[^>]*>([\s\S]*?)<\/div>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = reSection.exec(html2)) !== null) {
    const sec = m[1]!.trim();
    const content = m[2] ?? '';
    if (/Sample\s*Input/i.test(sec)) {
      const text = extractPreOrText(content);
      sampleInputs.push(text);
    } else if (/Sample\s*Output/i.test(sec)) {
      const text = extractPreOrText(content);
      sampleOutputs.push(text);
    } else {
      sections.set(sec, htmlSectionToMarkdown(content));
    }
    currentSection = sec;
  }

  // 若 panel_title 完全没匹配到,说明 HDOJ 结构变更,抛 PARSE_ERROR
  if (sections.size === 0 && sampleInputs.length === 0) {
    throw new AdapterError('PARSE_ERROR', 'HDOJ 题面解析失败:未找到 panel_title 段', false);
  }

  for (let i = 0; i < Math.max(sampleInputs.length, sampleOutputs.length); i++) {
    samples.push({
      input: sampleInputs[i] ?? '',
      output: sampleOutputs[i] ?? '',
    });
  }

  const parts: string[] = [];
  for (const [name, content] of sections) {
    if (!content) continue;
    parts.push(`### ${name}\n\n${content.trim()}\n`);
  }
  const statement = parts.join('\n');

  // 时间/内存限制:从页面顶部 "Time Limit: 1000/1000 MS (Java/Others)" 抽取
  const limitMatch = $.html().match(/Time\s*Limit:\s*\d+\/(\d+)\s*MS[\s\S]*?Memory\s*Limit:\s*\d+\/(\d+)\s*K/i);
  let timeLimitMs: number | undefined;
  let memoryLimitKb: number | undefined;
  if (limitMatch) {
    timeLimitMs = Number(limitMatch[1]);
    memoryLimitKb = Number(limitMatch[2]);
  }

  // 仅作为暂用变量保留(防 lint)
  void currentSection;

  return {
    platform: 'hdoj',
    id: pid,
    title,
    url: `http://acm.hdu.edu.cn/showproblem.php?pid=${pid}`,
    statement,
    samples,
    timeLimitMs,
    memoryLimitKb,
  };
}

export async function parseStatusFirstRow(
  html: string,
  username: string,
  pid: string,
): Promise<HdojStatusRow | undefined> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);

  // 状态表通常是 class="table_text" 的 table,第一个数据 tr 是表头,从第二个开始
  // 兼容多种 class,直接扫所有表格中含 8+ 列且第一个 td 为数字(RunID)的行
  const rows = $('table tr').toArray();
  for (const tr of rows) {
    const tds = $(tr).find('td');
    if (tds.length < 7) continue;
    const runId = $(tds[0]).text().trim();
    if (!/^\d+$/.test(runId)) continue;
    const status = $(tds[2]).text().trim();
    const rowPid = $(tds[3]).text().trim();
    const time = $(tds[4]).text().trim();
    const mem = $(tds[5]).text().trim();
    const lang = $(tds[7] ?? tds[6]).text().trim();
    const user = $(tds[8] ?? tds[7]).text().trim();
    if (pid && rowPid && rowPid !== pid) continue;
    if (username && user && user !== username) continue;
    return {
      runId,
      verdict: mapHdojVerdict(status),
      rawStatus: status,
      timeMs: parseHdojTime(time),
      memoryKb: parseHdojMemory(mem),
      language: lang,
    };
  }
  return undefined;
}

function mapHdojVerdict(s: string): PlatformVerdict {
  if (/Accepted/i.test(s)) return 'AC';
  if (/Presentation\s*Error/i.test(s)) return 'PE';
  if (/Wrong\s*Answer/i.test(s)) return 'WA';
  if (/Time\s*Limit\s*Exceeded/i.test(s)) return 'TLE';
  if (/Memory\s*Limit\s*Exceeded/i.test(s)) return 'MLE';
  if (/Output\s*Limit\s*Exceeded/i.test(s)) return 'WA';
  if (/Runtime\s*Error/i.test(s)) return 'RE';
  if (/Compilation\s*Error/i.test(s)) return 'CE';
  if (/Queuing|Compiling|Running/i.test(s)) return 'JUDGING';
  if (/Pending/i.test(s)) return 'PENDING';
  return 'UNKNOWN';
}

function parseHdojTime(s: string): number | undefined {
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function parseHdojMemory(s: string): number | undefined {
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function extractPreOrText(content: string): string {
  const m = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (m) return decodeHtml(stripTags(m[1]!)).replace(/^\n+/, '').replace(/\n+$/, '');
  return decodeHtml(stripTags(content)).trim();
}

function htmlSectionToMarkdown(content: string): string {
  // 简易实现:剥除 div 包裹,保留段落与 pre
  return decodeHtml(
    content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<pre[^>]*>/gi, '\n```\n')
      .replace(/<\/pre>/gi, '\n```\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
