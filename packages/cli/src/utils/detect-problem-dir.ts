/**
 * 从给定路径(或 CWD)向上查找 oja 工作区子目录。
 * 匹配形态:`<...>/<platform>/<id>-<slug>-<YYYY-MM-DD>/`
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';

const PLATFORMS = ['leetcode-cn', 'hdoj'];

export interface DetectedProblemDir {
  problemDir: string;
  platform: string;
  id: string;
  slug: string;
  date: string;
}

export async function detectProblemDir(start: string): Promise<DetectedProblemDir | undefined> {
  let cur = path.resolve(start);
  while (true) {
    const base = path.basename(cur);
    const parent = path.basename(path.dirname(cur));
    const m = base.match(/^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (m && PLATFORMS.includes(parent)) {
      // 校验存在 meta.json
      try {
        await fs.stat(path.join(cur, 'meta.json'));
        return {
          problemDir: cur,
          platform: parent,
          id: m[1]!,
          slug: m[2]!,
          date: m[3]!,
        };
      } catch {
        // 不存在 meta,继续向上
      }
    }
    const next = path.dirname(cur);
    if (next === cur) return undefined;
    cur = next;
  }
}
