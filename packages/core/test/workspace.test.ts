import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';
import { normalizeSlug } from '../src/workspace/slug.js';
import type { PlatformProblemDetail } from '../src/platform/adapter.js';

async function mkTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'oj-agent-ws-test-'));
}
async function rmRf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

function sampleDetail(over: Partial<PlatformProblemDetail> = {}): PlatformProblemDetail {
  return {
    platform: 'leetcode-cn',
    id: '1',
    title: '两数之和',
    statement: '# 两数之和\n\n给定数组...\n',
    samples: [
      { input: '[2,7,11,15]\n9', output: '[0,1]' },
      { input: '[3,2,4]\n6', output: '[1,2]' },
    ],
    url: 'https://leetcode.cn/problems/two-sum/',
    difficulty: 'Easy',
    tags: ['数组'],
    codeSnippets: { cpp: 'class Solution{};', python3: 'class Solution:' },
    ...over,
  };
}

test('normalizeSlug: 正常 slug', () => {
  assert.equal(normalizeSlug('two-sum', '1'), 'two-sum');
  assert.equal(normalizeSlug('Two Sum 2!', '1'), 'two-sum-2');
});

test('normalizeSlug: 中文回退', () => {
  const s = normalizeSlug('两数之和', '1');
  assert.match(s, /^p1-[a-f0-9]{8}$/);
});

test('WorkspaceManager: resolveProblemDir 命名', () => {
  const ws = new WorkspaceManager();
  const dir = ws.resolveProblemDir('leetcode-cn', '1', 'two-sum', '/root', new Date('2026-05-22T00:00:00Z'));
  assert.equal(dir, '/root/leetcode-cn/1-two-sum-2026-05-22');
});

test('WorkspaceManager: writeProblem 写盘所有字段', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    assert.equal(r.created, true);
    const problemMd = await fs.readFile(path.join(r.problemDir, 'problem.md'), 'utf-8');
    assert.match(problemMd, /两数之和/);
    const meta = JSON.parse(await fs.readFile(path.join(r.problemDir, 'meta.json'), 'utf-8'));
    assert.equal(meta.platform, 'leetcode-cn');
    assert.equal(meta.id, '1');
    assert.equal(meta.samples.length, 2);
    assert.ok(meta.statementHash);
    const in1 = await fs.readFile(path.join(r.problemDir, 'cases', 'in_1.txt'), 'utf-8');
    assert.equal(in1, '[2,7,11,15]\n9');
    const sol = await fs.readFile(r.solutionPath, 'utf-8');
    assert.equal(sol, 'class Solution{};');
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: solution.* 已存在不覆盖', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r1 = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    // 用户改了代码
    await fs.writeFile(r1.solutionPath, '// my code', 'utf-8');
    const r2 = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    assert.equal(r2.problemDir, r1.problemDir);
    const sol = await fs.readFile(r2.solutionPath, 'utf-8');
    assert.equal(sol, '// my code');
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: Java 文件名固定 Main.java', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'java' });
    assert.equal(path.basename(r.solutionPath), 'Main.java');
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: 缺模板写注释占位', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const detail = sampleDetail({ codeSnippets: {} });
    const r = await ws.writeProblem(detail, { rootDir: root, defaultLang: 'python3' });
    const content = await fs.readFile(r.solutionPath, 'utf-8');
    assert.match(content, /TODO/);
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: addCustomCase 追加编号 + 记录到 customCaseIndices', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    const n = await ws.addCustomCase(r.problemDir, '5\n', '5\n');
    assert.equal(n, 3);
    const in3 = await fs.readFile(path.join(r.problemDir, 'cases', 'in_3.txt'), 'utf-8');
    assert.equal(in3, '5\n');
    const meta = await ws.readMeta(r.problemDir);
    // 远端 sample 数不变(samples 只反映题面 sample)
    assert.equal(meta?.samples.length, 2);
    assert.deepEqual(meta?.customCaseIndices, [3]);
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: removeCustomCase 删除自定义用例与 meta 记录', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    const n = await ws.addCustomCase(r.problemDir, 'aaa', 'bbb');
    assert.equal(n, 3);
    const ok = await ws.removeCustomCase(r.problemDir, 3);
    assert.equal(ok, true);
    // 文件被删除
    await assert.rejects(fs.access(path.join(r.problemDir, 'cases', 'in_3.txt')));
    await assert.rejects(fs.access(path.join(r.problemDir, 'cases', 'out_3.txt')));
    const meta = await ws.readMeta(r.problemDir);
    assert.deepEqual(meta?.customCaseIndices, []);
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: removeCustomCase 拒绝删除远端 sample 编号', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    // 远端 sample 编号 1, 2,未登记为 customCaseIndices
    const ok = await ws.removeCustomCase(r.problemDir, 1);
    assert.equal(ok, false);
    // 文件仍在
    await fs.access(path.join(r.problemDir, 'cases', 'in_1.txt'));
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: refresh 保留 solution 与自定义用例', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    await fs.writeFile(r.solutionPath, '// my code', 'utf-8');
    await ws.addCustomCase(r.problemDir, 'custom in', 'custom out');

    // 模拟远端 statement 变更
    const newDetail = sampleDetail({ statement: '# 新的题面\n\n更新了。' });
    const res = await ws.refresh(newDetail, r.problemDir);
    assert.equal(res.refreshed, true);

    // problem.md 更新
    const md = await fs.readFile(path.join(r.problemDir, 'problem.md'), 'utf-8');
    assert.match(md, /新的题面/);
    // solution 不变
    const sol = await fs.readFile(r.solutionPath, 'utf-8');
    assert.equal(sol, '// my code');
    // 自定义用例(编号 3)保留
    const in3 = await fs.readFile(path.join(r.problemDir, 'cases', 'in_3.txt'), 'utf-8');
    assert.equal(in3, 'custom in');
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: refresh 内容相同时不写盘', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    const r = await ws.writeProblem(sampleDetail(), { rootDir: root, defaultLang: 'cpp' });
    const before = (await fs.stat(path.join(r.problemDir, 'problem.md'))).mtimeMs;
    // 等一拍以确保 mtime 不同
    await new Promise((res) => setTimeout(res, 10));
    const res = await ws.refresh(sampleDetail(), r.problemDir);
    assert.equal(res.refreshed, false);
    const after = (await fs.stat(path.join(r.problemDir, 'problem.md'))).mtimeMs;
    assert.equal(before, after);
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: readMeta 文件不存在返回 undefined', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    assert.equal(await ws.readMeta(root), undefined);
  } finally {
    await rmRf(root);
  }
});

test('WorkspaceManager: readMeta JSON 损坏返回 undefined,不抛错', async () => {
  const root = await mkTmpDir();
  try {
    const ws = new WorkspaceManager();
    await fs.writeFile(path.join(root, 'meta.json'), '{not json', 'utf-8');
    assert.equal(await ws.readMeta(root), undefined);
  } finally {
    await rmRf(root);
  }
});
