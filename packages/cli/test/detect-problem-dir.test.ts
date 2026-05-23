import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectProblemDir } from '../src/utils/detect-problem-dir.js';

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'oja-detect-test-'));
}

test('detectProblemDir: 标准结构命中', async () => {
  const root = await mkTmp();
  try {
    const dir = path.join(root, 'leetcode-cn', '1-two-sum-2026-05-22');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), '{}');
    const det = await detectProblemDir(dir);
    assert.ok(det);
    assert.equal(det!.platform, 'leetcode-cn');
    assert.equal(det!.id, '1');
    assert.equal(det!.slug, 'two-sum');
    assert.equal(det!.date, '2026-05-22');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detectProblemDir: 子目录向上找', async () => {
  const root = await mkTmp();
  try {
    const dir = path.join(root, 'hdoj', '1000-aplusb-2026-05-22');
    const sub = path.join(dir, 'cases');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), '{}');
    const det = await detectProblemDir(sub);
    assert.equal(det!.problemDir, dir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detectProblemDir: 不在工作区返回 undefined', async () => {
  const root = await mkTmp();
  try {
    const det = await detectProblemDir(root);
    assert.equal(det, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detectProblemDir: 形态匹配但无 meta.json,不算工作区', async () => {
  const root = await mkTmp();
  try {
    const dir = path.join(root, 'leetcode-cn', '1-fake-2026-05-22');
    await fs.mkdir(dir, { recursive: true });
    const det = await detectProblemDir(dir);
    assert.equal(det, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detectProblemDir: Codeforces 非纯数字题号', async () => {
  const root = await mkTmp();
  try {
    const dir = path.join(root, 'codeforces', '1900A-Cover-in-Water-2026-05-22');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), '{}');
    const det = await detectProblemDir(dir);
    assert.ok(det);
    assert.equal(det!.platform, 'codeforces');
    assert.equal(det!.id, '1900A');
    assert.equal(det!.slug, 'Cover-in-Water');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('detectProblemDir: 洛谷 P 前缀题号', async () => {
  const root = await mkTmp();
  try {
    const dir = path.join(root, 'luogu', 'P1001-A+B-2026-05-22');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), '{}');
    const det = await detectProblemDir(dir);
    assert.ok(det);
    assert.equal(det!.platform, 'luogu');
    assert.equal(det!.id, 'P1001');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
