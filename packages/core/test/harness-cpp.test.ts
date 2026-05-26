/**
 * C++ harness 生成器测试。
 *
 * 不仅检查生成文本，还**真实 g++ 编译并跑**用户 solution + harness，
 * 用真实的 stdin / stdout 验证：twoSum / reverseList / invertTree 三道题。
 *
 * 没有 g++ 时跳过编译测试，但纯文本生成测试仍会跑。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateCppHarness,
  cppTypeName,
} from '../src/judge/harness/cpp.js';
import { parseLeetcodeMetaData, type HarnessSpec } from '../src/judge/harness/spec.js';

const execFileP = promisify(execFile);

async function hasGpp(): Promise<boolean> {
  try {
    await execFileP('g++', ['--version']);
    return true;
  } catch {
    return false;
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runChild(bin: string, stdin: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const ch = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let so = '';
    let se = '';
    ch.stdout.on('data', (b) => (so += b.toString()));
    ch.stderr.on('data', (b) => (se += b.toString()));
    ch.once('close', (code) => resolve({ stdout: so, stderr: se, exitCode: code ?? -1 }));
    ch.stdin.write(stdin);
    ch.stdin.end();
  });
}

async function compileAndRun(
  solutionSrc: string,
  harnessSrc: string,
  stdin: string,
): Promise<RunResult & { compileOk: boolean; compileErr: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oja-harness-cpp-'));
  const solPath = path.join(dir, 'solution.cpp');
  const harPath = path.join(dir, 'harness.cpp');
  const outPath = path.join(dir, 'out');
  await fs.writeFile(solPath, solutionSrc, 'utf-8');
  await fs.writeFile(harPath, harnessSrc, 'utf-8');
  try {
    await execFileP('g++', ['-O0', '-std=c++17', '-o', outPath, harPath], { cwd: dir });
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return { compileOk: false, compileErr: err.stderr ?? err.message ?? '', stdout: '', stderr: '', exitCode: -1 };
  }
  const res = await runChild(outPath, stdin);
  await fs.rm(dir, { recursive: true, force: true });
  return { compileOk: true, compileErr: '', ...res };
}

// ---------- 纯文本生成测试 ----------

test('cppTypeName 各类型映射', () => {
  assert.equal(cppTypeName({ tag: 'int' }), 'int');
  assert.equal(cppTypeName({ tag: 'long' }), 'long long');
  assert.equal(cppTypeName({ tag: 'double' }), 'double');
  assert.equal(cppTypeName({ tag: 'bool' }), 'bool');
  assert.equal(cppTypeName({ tag: 'string' }), 'std::string');
  assert.equal(cppTypeName({ tag: 'char' }), 'char');
  assert.equal(cppTypeName({ tag: 'array', elem: { tag: 'int' } }), 'std::vector<int>');
  assert.equal(
    cppTypeName({ tag: 'array', elem: { tag: 'array', elem: { tag: 'int' } } }),
    'std::vector<std::vector<int>>',
  );
  assert.equal(cppTypeName({ tag: 'listnode' }), 'ListNode*');
  assert.equal(cppTypeName({ tag: 'treenode' }), 'TreeNode*');
});

test('generateCppHarness twoSum 含必要片段', () => {
  const spec: HarnessSpec = {
    kind: 'function',
    funcName: 'twoSum',
    params: [
      { name: 'nums', type: { tag: 'array', elem: { tag: 'int' } } },
      { name: 'target', type: { tag: 'int' } },
    ],
    returnType: { tag: 'array', elem: { tag: 'int' } },
  };
  const src = generateCppHarness(spec);
  assert.match(src, /#include <vector>/);
  assert.match(src, /#include <iostream>/);
  assert.match(src, /#include "solution\.cpp"/);
  assert.match(src, /__sol\.twoSum\(nums, target\)/);
  assert.match(src, /std::vector<int> nums/);
  assert.match(src, /int target/);
  // 不应注入 ListNode/TreeNode（这题没用）
  assert.equal(src.includes('struct ListNode {'), false);
  assert.equal(src.includes('struct TreeNode {'), false);
});

test('generateCppHarness ListNode 题注入 ListNode 定义', () => {
  const spec: HarnessSpec = {
    kind: 'function',
    funcName: 'reverseList',
    params: [{ name: 'head', type: { tag: 'listnode' } }],
    returnType: { tag: 'listnode' },
  };
  const src = generateCppHarness(spec);
  assert.match(src, /struct ListNode \{/);
  assert.match(src, /__sol\.reverseList\(head\)/);
  assert.equal(src.includes('struct TreeNode {'), false);
});

test('generateCppHarness TreeNode 题注入 TreeNode 定义', () => {
  const spec: HarnessSpec = {
    kind: 'function',
    funcName: 'invertTree',
    params: [{ name: 'root', type: { tag: 'treenode' } }],
    returnType: { tag: 'treenode' },
  };
  const src = generateCppHarness(spec);
  assert.match(src, /struct TreeNode \{/);
});

test('generateCppHarness 拒绝 unsupported', () => {
  assert.throws(() =>
    generateCppHarness({ kind: 'unsupported', reason: 'systemdesign' }),
  );
});

// ---------- 真实编译运行测试 ----------

test('e2e twoSum: 编译并跑通三组样例', { skip: !(await hasGpp()) }, async () => {
  const meta = `{
    "name": "twoSum",
    "params": [
      { "name": "nums", "type": "integer[]" },
      { "name": "target", "type": "integer" }
    ],
    "return": { "type": "integer[]" }
  }`;
  const spec = parseLeetcodeMetaData(meta);
  const harness = generateCppHarness(spec);
  const solution = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int,int> m;
        for (int i = 0; i < (int)nums.size(); ++i) {
            int need = target - nums[i];
            if (m.count(need)) return {m[need], i};
            m[nums[i]] = i;
        }
        return {};
    }
};`;
  const samples: Array<[string, string]> = [
    ['[2,7,11,15]\n9', '[0,1]'],
    ['[3,2,4]\n6', '[1,2]'],
    ['[3,3]\n6', '[0,1]'],
  ];
  for (const [input, expected] of samples) {
    const res = await compileAndRun(solution, harness, input);
    assert.ok(res.compileOk, `compile failed:\n${res.compileErr}`);
    assert.equal(res.stdout.trim(), expected);
  }
});

test('e2e reverseList: 编译并跑通', { skip: !(await hasGpp()) }, async () => {
  const meta = `{
    "name": "reverseList",
    "params": [{ "name": "head", "type": "ListNode" }],
    "return": { "type": "ListNode" }
  }`;
  const spec = parseLeetcodeMetaData(meta);
  const harness = generateCppHarness(spec);
  const solution = `class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode* prev = nullptr;
        while (head) {
            ListNode* nxt = head->next;
            head->next = prev;
            prev = head;
            head = nxt;
        }
        return prev;
    }
};`;
  const cases: Array<[string, string]> = [
    ['[1,2,3,4,5]', '[5,4,3,2,1]'],
    ['[1,2]', '[2,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const res = await compileAndRun(solution, harness, input);
    assert.ok(res.compileOk, `compile failed:\n${res.compileErr}`);
    assert.equal(res.stdout.trim(), expected);
  }
});

test('e2e invertTree: 编译并跑通', { skip: !(await hasGpp()) }, async () => {
  const meta = `{
    "name": "invertTree",
    "params": [{ "name": "root", "type": "TreeNode" }],
    "return": { "type": "TreeNode" }
  }`;
  const spec = parseLeetcodeMetaData(meta);
  const harness = generateCppHarness(spec);
  const solution = `class Solution {
public:
    TreeNode* invertTree(TreeNode* root) {
        if (!root) return nullptr;
        swap(root->left, root->right);
        invertTree(root->left);
        invertTree(root->right);
        return root;
    }
};`;
  const cases: Array<[string, string]> = [
    ['[4,2,7,1,3,6,9]', '[4,7,2,9,6,3,1]'],
    ['[2,1,3]', '[2,3,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const res = await compileAndRun(solution, harness, input);
    assert.ok(res.compileOk, `compile failed:\n${res.compileErr}`);
    assert.equal(res.stdout.trim(), expected);
  }
});

test('e2e 基础类型: 字符串 / bool / double 来回', { skip: !(await hasGpp()) }, async () => {
  // 用一道虚拟"回声"题:接收 (string, bool, double) 返回 string + 拼接
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
  const harness = generateCppHarness(spec);
  const solution = `class Solution {
public:
    string echo(string s, bool b, double d) {
        return s + ":" + (b ? "T" : "F") + ":" + to_string((int)(d * 10));
    }
};`;
  const res = await compileAndRun(solution, harness, '"hi"\ntrue\n3.5');
  assert.ok(res.compileOk, `compile failed:\n${res.compileErr}`);
  assert.equal(res.stdout.trim(), '"hi:T:35"');
});
