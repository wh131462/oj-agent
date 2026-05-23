/**
 * 洛谷页面 JSON 解析。
 *
 * 所有题目 / 列表数据都内嵌在页面 `<script id="lentille-context" type="application/json">` 节点中，
 * 直接走非官方 JSON 接口（`?_contentOnly=1`）参数不稳定且偶发返回 HTML，已被否决。
 */

import { AdapterError } from '../errors.js';
import type {
  LentilleProblemDetailContext,
  LentilleProblemListContext,
  LuoguProblemDetailRaw,
} from './types.js';

/**
 * 抽取 `<script id="lentille-context" type="application/json">...</script>` 中的 JSON 字符串。
 */
export function extractLentilleContext(html: string): unknown {
  const m = html.match(
    /<script[^>]*id="lentille-context"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) {
    throw new AdapterError(
      'PARSE_ERROR',
      '洛谷页面未找到 lentille-context script 节点（页面结构可能已变动）',
      false,
    );
  }
  const raw = m[1]!.trim();
  if (!raw) {
    throw new AdapterError(
      'PARSE_ERROR',
      '洛谷 lentille-context 节点为空',
      false,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new AdapterError(
      'PARSE_ERROR',
      'lentille-context JSON 解析失败',
      false,
      e,
    );
  }
}

export function parseListContext(
  context: unknown,
): LentilleProblemListContext['data']['problems'] {
  const ctx = context as Partial<LentilleProblemListContext>;
  const problems = ctx?.data?.problems;
  if (!problems || !Array.isArray(problems.result)) {
    throw new AdapterError(
      'PARSE_ERROR',
      'lentille-context 缺少 data.problems.result 字段',
      false,
    );
  }
  return problems;
}

export function parseDetailContext(context: unknown): LuoguProblemDetailRaw {
  const ctx = context as Partial<LentilleProblemDetailContext>;
  const p = ctx?.data?.problem;
  if (!p || typeof p.pid !== 'string') {
    throw new AdapterError(
      'PARSE_ERROR',
      'lentille-context 缺少 data.problem 字段',
      false,
    );
  }
  return p;
}

/**
 * 从详情页 HTML 中抓取 CSRF token。
 *
 * 洛谷把 csrf token 放在 `<meta name="csrf-token" content="...">` 中。
 */
export function extractCsrfToken(html: string): string | undefined {
  const m = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i);
  return m?.[1];
}

/**
 * 把 LuoguProblemDetailRaw 拼装成 Markdown 题面。
 *
 * 兼容两种返回结构：
 * 1. 旧版：`contenu.content` 一段完整 Markdown
 * 2. 新版：分字段（`background / description / inputFormat / ...`）
 */
export function assembleStatement(p: LuoguProblemDetailRaw): string {
  // 新版字段优先
  const parts: string[] = [];
  if (p.background) parts.push(`## 题目背景\n\n${p.background}`);
  if (p.description) parts.push(`## 题目描述\n\n${p.description}`);
  if (p.inputFormat) parts.push(`## 输入格式\n\n${p.inputFormat}`);
  if (p.outputFormat) parts.push(`## 输出格式\n\n${p.outputFormat}`);
  if (p.hint) parts.push(`## 说明/提示\n\n${p.hint}`);
  if (parts.length > 0) return parts.join('\n\n');

  // 兜底：旧版 contenu.content
  if (p.contenu?.content) return p.contenu.content;

  throw new AdapterError(
    'PARSE_ERROR',
    `洛谷题目 ${p.pid} 题面字段全空`,
    false,
  );
}
