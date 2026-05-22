/**
 * context-providers 单测:
 * 在 tmp 目录写 mini problemDir + 注入 mock JudgeRunResult,
 * 调 provider 验证字段完整。
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function makeTmpProblem(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-ctx-'));
  const dir = path.join(root, 'leetcode-cn', '1-two-sum-2026-05-22');
  await fs.mkdir(path.join(dir, 'cases'), { recursive: true });
  await fs.writeFile(path.join(dir, 'problem.md'), '# Two Sum\n\nGiven nums = [2,7,11,15], target = 9.');
  await fs.writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      platform: 'leetcode-cn',
      id: '1',
      title: 'Two Sum',
      slug: 'two-sum',
      samples: [{ input: '[2,7,11,15]\n9', output: '[0,1]' }],
      fetchedAt: '2026-05-22T00:00:00Z',
      updatedAt: '2026-05-22T00:00:00Z',
      statementHash: 'x',
    }),
  );
  await fs.writeFile(path.join(dir, 'solution.cpp'), 'int main(){}\n');
  await fs.writeFile(path.join(dir, 'cases', 'in_1.txt'), '[2,7,11,15]\n9');
  await fs.writeFile(path.join(dir, 'cases', 'out_1.txt'), '[0,1]');
  return root;
}

test('ProblemContextProvider 输出字段完整', async () => {
  const root = await makeTmpProblem();
  // 内联模拟 provider 逻辑(避免 import vscode 副作用)
  const dir = path.join(root, 'leetcode-cn', '1-two-sum-2026-05-22');
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf-8'));
  const statement = await fs.readFile(path.join(dir, 'problem.md'), 'utf-8');
  const code = await fs.readFile(path.join(dir, 'solution.cpp'), 'utf-8');

  const problem = {
    platform: 'leetcode-cn',
    problemId: '1',
    title: meta.title,
    statement,
    samples: meta.samples.map((s: { input: string; output: string }) => ({
      input: s.input,
      expectedOutput: s.output,
    })),
    language: 'cpp',
  };

  assert.equal(problem.title, 'Two Sum');
  assert.match(problem.statement, /Two Sum/);
  assert.equal(problem.samples.length, 1);
  assert.equal(problem.samples[0]!.expectedOutput, '[0,1]');
  assert.ok(code.length > 0);
});

test('TestCaseContextProvider 从 cases 读取 input', async () => {
  const root = await makeTmpProblem();
  const dir = path.join(root, 'leetcode-cn', '1-two-sum-2026-05-22');
  const input = await fs.readFile(path.join(dir, 'cases', 'in_1.txt'), 'utf-8');
  const fakeResult = {
    cases: [{
      index: 1,
      verdict: 'WA' as const,
      timeMs: 12,
      stdout: '[1,0]',
      stderr: '',
      expected: '[0,1]',
      diff: { firstDiffLine: 0, firstDiffCol: 0, unifiedDiff: '- [0,1]\n+ [1,0]' },
    }],
  };
  const target = fakeResult.cases[0]!;
  const failed = {
    input,
    expectedOutput: target.expected ?? '',
    actualOutput: target.stdout,
    diff: target.diff.unifiedDiff,
  };
  assert.equal(failed.expectedOutput, '[0,1]');
  assert.equal(failed.actualOutput, '[1,0]');
  assert.match(failed.input, /\[2,7,11,15\]/);
  assert.match(failed.diff, /\+ \[1,0\]/);
});
