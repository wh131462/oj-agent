/**
 * slug 规范化。
 *
 * 规则:
 * - 小写、仅保留 ASCII 字母数字与 `-`,其它字符转 `-`(连续合并)
 * - 截断到 60 字符
 * - 若结果为空(或原文全为非 ASCII 字符),回退为 `p<id>-<sha1(rawSlug).slice(0,8)>`
 */

import { createHash } from 'node:crypto';

export function normalizeSlug(rawSlug: string, id: string): string {
  const slug = (rawSlug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (slug) return slug;
  // 回退:把原 slug 做 sha1 取前 8 位
  const hash = createHash('sha1').update(rawSlug ?? '').digest('hex').slice(0, 8);
  return `p${id}-${hash}`;
}
