/**
 * cheerio lazy loader,HDOJ 与 LeetCode 共享。
 */

let cheerioPromise: Promise<typeof import('cheerio')> | null = null;

export async function loadCheerio() {
  if (!cheerioPromise) cheerioPromise = import('cheerio');
  return cheerioPromise;
}
