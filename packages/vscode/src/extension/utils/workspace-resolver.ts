import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { PlatformId } from '@oj-agent/core';
import type { ProblemRef } from './problem-ref.js';

/**
 * 根据 root + ref 推断 problemDir。
 * 规则:`<root>/<platform>/<id>-<slug>-<YYYY-MM-DD>/`,
 * 同一题目可能有多个日期目录(每次拉取覆盖最新),取**修改时间最新**的。
 */
export async function findProblemDir(root: string, ref: ProblemRef): Promise<string | undefined> {
  const platformDir = path.join(expandHome(root), ref.platform);
  let entries: string[];
  try {
    entries = await fs.readdir(platformDir);
  } catch {
    return undefined;
  }
  const prefix = `${ref.id}-`;
  const candidates: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    try {
      const stat = await fs.stat(path.join(platformDir, name));
      if (stat.isDirectory()) candidates.push({ name, mtime: stat.mtimeMs });
    } catch {
      /* ignore */
    }
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return path.join(platformDir, candidates[0]!.name);
}

export function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/**
 * 从 problemDir 名字反推 platform / id;若失败返回 undefined。
 * Dir 形如 `<root>/<platform>/<id>-<slug>-<date>/`。
 */
export function inferRefFromDir(dir: string): ProblemRef | undefined {
  const segs = dir.split(path.sep).filter(Boolean);
  if (segs.length < 2) return undefined;
  const last = segs[segs.length - 1]!;
  const platformSeg = segs[segs.length - 2]!;
  if (!isPlatformId(platformSeg)) return undefined;
  const m = last.match(/^([^-]+)-(.+)-(\d{4}-\d{2}-\d{2})$/);
  if (!m) return undefined;
  return { platform: platformSeg, id: m[1]!, slug: m[2]! };
}

function isPlatformId(s: string): s is PlatformId {
  return s === 'leetcode-cn' || s === 'hdoj' || s === 'codeforces' || s === 'luogu' || s === 'poj' || s === 'lanqiao';
}
