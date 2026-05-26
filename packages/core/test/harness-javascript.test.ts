/**
 * JavaScript harness 生成器测试。真实 node 端到端执行三道题。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateJsHarness } from '../src/judge/harness/javascript.js';
import { parseLeetcodeMetaData, type HarnessSpec } from '../src/judge/harness/spec.js';

function runNode(cwd: string, stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, ['harness.js'], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let so = '';
    let se = '';
    ch.stdout.on('data', (b) => (so += b.toString()));
    ch.stderr.on('data', (b) => (se += b.toString()));
    ch.once('close', (code) => resolve({ stdout: so, stderr: se, exitCode: code ?? -1 }));
    ch.stdin.write(stdin);
    ch.stdin.end();
  });
}

async function runJs(solution: string, harness: string, stdin: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oja-harness-js-'));
  await fs.writeFile(path.join(dir, 'solution.js'), solution, 'utf-8');
  await fs.writeFile(path.join(dir, 'harness.js'), harness, 'utf-8');
  const res = await runNode(dir, stdin);
  await fs.rm(dir, { recursive: true, force: true });
  return res;
}

test('js: 拒绝 unsupported', () => {
  assert.throws(() => generateJsHarness({ kind: 'unsupported', reason: 'systemdesign' }));
});

test('js e2e twoSum', async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "twoSum",
    "params": [{"name":"nums","type":"integer[]"},{"name":"target","type":"integer"}],
    "return": {"type": "integer[]"}
  }`);
  const harness = generateJsHarness(spec);
  // 故意保留 leetcode 网页上的原始形态:var foo = function(...) {}, 无 export
  const solution = `var twoSum = function(nums, target) {
  const m = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (m.has(target - nums[i])) return [m.get(target - nums[i]), i];
    m.set(nums[i], i);
  }
  return [];
};`;
  const cases: Array<[string, string]> = [
    ['[2,7,11,15]\n9', '[0,1]'],
    ['[3,2,4]\n6', '[1,2]'],
    ['[3,3]\n6', '[0,1]'],
  ];
  for (const [input, expected] of cases) {
    const r = await runJs(solution, harness, input);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('js e2e reverseList', async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "reverseList",
    "params": [{"name":"head","type":"ListNode"}],
    "return": {"type": "ListNode"}
  }`);
  const harness = generateJsHarness(spec);
  const solution = `var reverseList = function(head) {
  let prev = null;
  while (head) {
    const nxt = head.next;
    head.next = prev;
    prev = head;
    head = nxt;
  }
  return prev;
};`;
  const cases: Array<[string, string]> = [
    ['[1,2,3,4,5]', '[5,4,3,2,1]'],
    ['[1,2]', '[2,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const r = await runJs(solution, harness, input);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('js e2e invertTree', async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "invertTree",
    "params": [{"name":"root","type":"TreeNode"}],
    "return": {"type": "TreeNode"}
  }`);
  const harness = generateJsHarness(spec);
  const solution = `var invertTree = function(root) {
  if (!root) return null;
  const t = root.left;
  root.left = root.right;
  root.right = t;
  invertTree(root.left);
  invertTree(root.right);
  return root;
};`;
  const cases: Array<[string, string]> = [
    ['[4,2,7,1,3,6,9]', '[4,7,2,9,6,3,1]'],
    ['[2,1,3]', '[2,3,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const r = await runJs(solution, harness, input);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('js e2e 基础类型: string/bool/double', async () => {
  const spec: HarnessSpec = {
    kind: 'function',
    funcName: 'echo',
    params: [
      { name: 's', type: { tag: 'string' } },
      { name: 'b', type: { tag: 'bool' } },
      { name: 'd', type: { tag: 'double' } },
    ],
    returnType: { tag: 'string' },
  };
  const harness = generateJsHarness(spec);
  const solution = `var echo = function(s, b, d) {
  return s + ":" + (b ? "T" : "F") + ":" + Math.floor(d * 10);
};`;
  const r = await runJs(solution, harness, '"hi"\ntrue\n3.5');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stdout.trim(), '"hi:T:35"');
});
