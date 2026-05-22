import type { PlatformId } from '@oj-agent/core';

export interface ProblemRef {
  platform: PlatformId;
  id: string;
  slug?: string;
}

/**
 * 从 URL 解析平台与题目 id/slug。支持:
 * - https://leetcode.cn/problems/<slug>/
 * - https://leetcode.com/problems/<slug>/ (M1 也容错为 leetcode-cn)
 * - http://acm.hdu.edu.cn/showproblem.php?pid=<id>
 */
export function parseProblemUrl(url: string): ProblemRef | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  // LeetCode CN
  const lc = trimmed.match(/leetcode\.(cn|com)\/problems\/([^/?#]+)/i);
  if (lc) {
    const slug = lc[2]!;
    return { platform: 'leetcode-cn', id: slug, slug };
  }

  // HDOJ
  const hdoj = trimmed.match(/hdu\.edu\.cn\/.*[?&]pid=(\d+)/i);
  if (hdoj) {
    const id = hdoj[1]!;
    return { platform: 'hdoj', id, slug: id };
  }

  return undefined;
}

export function problemRefKey(ref: ProblemRef): string {
  return `${ref.platform}:${ref.id}`;
}
