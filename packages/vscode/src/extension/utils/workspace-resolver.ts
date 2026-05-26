import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { PlatformId } from '@oj-agent/core';
import type { ProblemRef } from './problem-ref.js';

/**
 * 根据 root + ref 推断 problemDir。
 * 规则:`<root>/<platform>/<id>-<slug>/` 或 `<root>/<platform>/<id>/`(slug 缺失时)。
 */
export async function findProblemDir(root: string, ref: ProblemRef): Promise<string | undefined> {
  const platformDir = path.join(expandHome(root), ref.platform);
  const candidates = ref.slug ? [`${ref.id}-${ref.slug}`, ref.id] : [ref.id];
  for (const name of candidates) {
    const p = path.join(platformDir, name);
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/**
 * 从 problemDir 名字反推 platform / id;若失败返回 undefined。
 * Dir 形如 `<root>/<platform>/<id>-<slug>/` 或 `<root>/<platform>/<id>/`。
 */
export function inferRefFromDir(dir: string): ProblemRef | undefined {
  const segs = dir.split(path.sep).filter(Boolean);
  if (segs.length < 2) return undefined;
  const last = segs[segs.length - 1]!;
  const platformSeg = segs[segs.length - 2]!;
  if (!isPlatformId(platformSeg)) return undefined;
  const m = last.match(/^([^-]+)(?:-(.+))?$/);
  if (!m) return undefined;
  const slug = m[2];
  return slug ? { platform: platformSeg, id: m[1]!, slug } : { platform: platformSeg, id: m[1]! };
}

function isPlatformId(s: string): s is PlatformId {
  return s === 'leetcode-cn' || s === 'hdoj' || s === 'codeforces' || s === 'luogu' || s === 'poj' || s === 'lanqiao';
}
