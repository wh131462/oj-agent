/**
 * 从给定路径(或 CWD)向上查找 oja 工作区子目录。
 * 匹配形态:`<...>/<platform>/<id>-<slug>/` 或 `<...>/<platform>/<id>/`。
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';

const PLATFORMS = ['leetcode-cn', 'hdoj', 'codeforces', 'luogu', 'poj', 'lanqiao'];

export interface DetectedProblemDir {
  problemDir: string;
  platform: string;
  id: string;
  slug: string;
}

export async function detectProblemDir(start: string): Promise<DetectedProblemDir | undefined> {
  let cur = path.resolve(start);
  while (true) {
    const base = path.basename(cur);
    const parent = path.basename(path.dirname(cur));
    const m = base.match(/^([^-]+)(?:-(.+))?$/);
    if (m && PLATFORMS.includes(parent)) {
      // 校验存在 meta.json
      try {
        await fs.stat(path.join(cur, 'meta.json'));
        return {
          problemDir: cur,
          platform: parent,
          id: m[1]!,
          slug: m[2] ?? '',
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
