/**
 * 编译产物缓存路径。
 *
 * key = sha256(srcContent + '\0' + 渲染后的 compileCmd)
 * 路径:<problemDir>/.build/<hash>/
 *
 * 命中条件:目录存在。命中时跳过编译。
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export function computeBuildHash(srcContent: string, compileCmd: string): string {
  return createHash('sha256').update(srcContent).update('\0').update(compileCmd).digest('hex');
}

export function getBuildDir(problemDir: string, hash: string): string {
  return path.join(problemDir, '.build', hash);
}

export async function buildDirExists(buildDir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(buildDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function ensureBuildDir(buildDir: string): Promise<void> {
  await fs.mkdir(buildDir, { recursive: true });
}
