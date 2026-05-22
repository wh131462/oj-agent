/**
 * JudgeRunner 单测。
 *
 * 策略:用 javascript(node)作为目标语言,避开 g++/javac 依赖,
 * 这样在任何安装了 Node 的环境都能跑(包括 CI)。
 * 编译相关分支(template 渲染、缓存命中、CE)用模板注入和 mock 验证。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { JudgeRunner } from '../src/judge/runner.js';
import { normalize, firstDiff, unifiedDiff } from '../src/judge/normalize.js';
import { renderTemplate, shellQuote } from '../src/judge/template.js';
import { computeBuildHash } from '../src/judge/cache.js';

async function mkProblemDir(solution: string, samples: Array<{ input: string; expected?: string }>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-agent-judge-test-'));
  const problemDir = path.join(root, 'leetcode-cn', '1-test-2026-05-22');
  await fs.mkdir(path.join(problemDir, 'cases'), { recursive: true });
  await fs.writeFile(path.join(problemDir, 'solution.js'), solution, 'utf-8');
  for (let i = 0; i < samples.length; i++) {
    const n = i + 1;
    await fs.writeFile(path.join(problemDir, 'cases', `in_${n}.txt`), samples[i]!.input, 'utf-8');
    if (samples[i]!.expected !== undefined) {
      await fs.writeFile(path.join(problemDir, 'cases', `out_${n}.txt`), samples[i]!.expected!, 'utf-8');
    }
  }
  return { root, problemDir };
}

test('normalize: 行尾空格与末尾换行不影响', () => {
  assert.equal(normalize('1 \n2  \n'), normalize('1\n2'));
  assert.equal(normalize('a\nb'), 'a\nb');
  assert.equal(normalize('a\n\n\n'), 'a');
});

test('firstDiff: 行列定位', () => {
  const fd = firstDiff('abc\ndef\n', 'abc\ndeg\n');
  assert.equal(fd?.line, 2);
  assert.equal(fd?.col, 2);
});

test('firstDiff: 完全相等返回 undefined', () => {
  assert.equal(firstDiff('a\nb\n', 'a\nb\n'), undefined);
});

test('unifiedDiff: 截断 100 行', () => {
  const a = Array.from({ length: 300 }, (_, i) => `x${i}`).join('\n');
  const b = Array.from({ length: 300 }, (_, i) => `y${i}`).join('\n');
  const d = unifiedDiff(a, b, 100);
  assert.match(d, /more lines elided/);
});

test('renderTemplate: 占位符替换', () => {
  const cmd = renderTemplate('g++ -O2 -o {out} {src}', { src: '/tmp/x.cpp', out: '/tmp/x' });
  assert.equal(cmd, 'g++ -O2 -o /tmp/x /tmp/x.cpp');
});

test('renderTemplate: shellQuote 含空格', () => {
  const cmd = renderTemplate('echo {src}', { src: '/tmp/has space' });
  assert.equal(cmd, "echo '/tmp/has space'");
});

test('shellQuote: 边界', () => {
  assert.equal(shellQuote('abc'), 'abc');
  assert.equal(shellQuote(''), "''");
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

test('computeBuildHash: 不同输入产生不同 hash', () => {
  const a = computeBuildHash('code', 'g++');
  const b = computeBuildHash('code2', 'g++');
  const c = computeBuildHash('code', 'clang++');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('JudgeRunner: js AC', async () => {
  const { root, problemDir } = await mkProblemDir(
    `let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const n = data.trim().split(/\\s+/).map(Number);
  console.log(n[0] + n[1]);
});
`,
    [{ input: '1 2', expected: '3' }, { input: '10 20', expected: '30' }],
  );
  try {
    const runner = new JudgeRunner();
    const r = await runner.runAll({ problemDir, lang: 'javascript', timeoutMs: 5000 });
    assert.equal(r.cases.length, 2);
    assert.equal(r.cases[0]!.verdict, 'AC');
    assert.equal(r.cases[1]!.verdict, 'AC');
    assert.equal(r.compileError, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('JudgeRunner: js WA + diff ���处差异', async () => {
  const { root, problemDir } = await mkProblemDir(
    `console.log('abc'); console.log('def');`,
    [{ input: '', expected: 'abc\ndeg' }],
  );
  try {
    const runner = new JudgeRunner();
    const r = await runner.runAll({ problemDir, lang: 'javascript', timeoutMs: 5000 });
    assert.equal(r.cases[0]!.verdict, 'WA');
    assert.equal(r.cases[0]!.diff?.firstDiffLine, 2);
    assert.equal(r.cases[0]!.diff?.firstDiffCol, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('JudgeRunner: js TLE', async () => {
  const { root, problemDir } = await mkProblemDir(
    `setTimeout(() => console.log('done'), 5000);`,
    [{ input: '', expected: 'done' }],
  );
  try {
    const runner = new JudgeRunner();
    const r = await runner.runAll({ problemDir, lang: 'javascript', timeoutMs: 500 });
    assert.equal(r.cases[0]!.verdict, 'TLE');
    assert.ok(r.cases[0]!.timeMs >= 500);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('JudgeRunner: js RE(非零退出)', async () => {
  const { root, problemDir } = await mkProblemDir(
    `process.exit(1);`,
    [{ input: '', expected: '' }],
  );
  try {
    const runner = new JudgeRunner();
    const r = await runner.runAll({ problemDir, lang: 'javascript', timeoutMs: 3000 });
    assert.equal(r.cases[0]!.verdict, 'RE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('JudgeRunner: 行尾空格归一化为 AC', async () => {
  const { root, problemDir } = await mkProblemDir(
    `console.log('1   '); console.log('2');`,
    [{ input: '', expected: '1\n2\n' }],
  );
  try {
    const runner = new JudgeRunner();
    const r = await runner.runAll({ problemDir, lang: 'javascript', timeoutMs: 3000 });
    assert.equal(r.cases[0]!.verdict, 'AC');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
