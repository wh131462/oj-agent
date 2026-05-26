/**
 * Python3 harness 生成器测试。真实 python3 端到端执行三道题。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generatePythonHarness } from '../src/judge/harness/python.js';
import { parseLeetcodeMetaData, type HarnessSpec } from '../src/judge/harness/spec.js';

const execFileP = promisify(execFile);

async function hasPython(): Promise<boolean> {
  try {
    await execFileP('python3', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function runChild(bin: string, args: string[], stdin: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const ch = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let so = '';
    let se = '';
    ch.stdout.on('data', (b) => (so += b.toString()));
    ch.stderr.on('data', (b) => (se += b.toString()));
    ch.once('close', (code) => resolve({ stdout: so, stderr: se, exitCode: code ?? -1 }));
    ch.stdin.write(stdin);
    ch.stdin.end();
  });
}

async function runPython(solution: string, harness: string, stdin: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oja-harness-py-'));
  await fs.writeFile(path.join(dir, 'solution.py'), solution, 'utf-8');
  await fs.writeFile(path.join(dir, 'harness.py'), harness, 'utf-8');
  const res = await runChild('python3', ['harness.py'], stdin, dir);
  await fs.rm(dir, { recursive: true, force: true });
  return res;
}

test('python: 拒绝 unsupported', () => {
  assert.throws(() => generatePythonHarness({ kind: 'unsupported', reason: 'systemdesign' }));
});

test('python: 不用 ListNode 的题不注入定义', () => {
  const spec: HarnessSpec = {
    kind: 'function',
    funcName: 'twoSum',
    params: [
      { name: 'nums', type: { tag: 'array', elem: { tag: 'int' } } },
      { name: 'target', type: { tag: 'int' } },
    ],
    returnType: { tag: 'array', elem: { tag: 'int' } },
  };
  const src = generatePythonHarness(spec);
  assert.equal(src.includes('class ListNode'), false);
  assert.equal(src.includes('class TreeNode'), false);
});

test('python e2e twoSum', { skip: !(await hasPython()) }, async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "twoSum",
    "params": [
      {"name": "nums", "type": "integer[]"},
      {"name": "target", "type": "integer"}
    ],
    "return": {"type": "integer[]"}
  }`);
  const harness = generatePythonHarness(spec);
  const solution = `class Solution:
    def twoSum(self, nums, target):
        m = {}
        for i, x in enumerate(nums):
            if target - x in m:
                return [m[target - x], i]
            m[x] = i
        return []
`;
  const cases: Array<[string, string]> = [
    ['[2,7,11,15]\n9', '[0,1]'],
    ['[3,2,4]\n6', '[1,2]'],
    ['[3,3]\n6', '[0,1]'],
  ];
  for (const [input, expected] of cases) {
    const r = await runPython(solution, harness, input);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('python e2e reverseList', { skip: !(await hasPython()) }, async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "reverseList",
    "params": [{"name": "head", "type": "ListNode"}],
    "return": {"type": "ListNode"}
  }`);
  const harness = generatePythonHarness(spec);
  const solution = `class Solution:
    def reverseList(self, head):
        prev = None
        while head:
            nxt = head.next
            head.next = prev
            prev = head
            head = nxt
        return prev
`;
  const cases: Array<[string, string]> = [
    ['[1,2,3,4,5]', '[5,4,3,2,1]'],
    ['[1,2]', '[2,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const r = await runPython(solution, harness, input);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('python e2e invertTree', { skip: !(await hasPython()) }, async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "invertTree",
    "params": [{"name": "root", "type": "TreeNode"}],
    "return": {"type": "TreeNode"}
  }`);
  const harness = generatePythonHarness(spec);
  const solution = `class Solution:
    def invertTree(self, root):
        if not root: return None
        root.left, root.right = root.right, root.left
        self.invertTree(root.left)
        self.invertTree(root.right)
        return root
`;
  const cases: Array<[string, string]> = [
    ['[4,2,7,1,3,6,9]', '[4,7,2,9,6,3,1]'],
    ['[2,1,3]', '[2,3,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const r = await runPython(solution, harness, input);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('python e2e 基础类型: string/bool/double', { skip: !(await hasPython()) }, async () => {
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
  const harness = generatePythonHarness(spec);
  const solution = `class Solution:
    def echo(self, s, b, d):
        return s + ":" + ("T" if b else "F") + ":" + str(int(d*10))
`;
  const r = await runPython(solution, harness, '"hi"\ntrue\n3.5');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stdout.trim(), '"hi:T:35"');
});
