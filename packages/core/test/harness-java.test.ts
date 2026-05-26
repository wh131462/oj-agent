/**
 * Java harness 生成器测试。真实 javac + java 端到端执行三道题。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateJavaHarness } from '../src/judge/harness/java.js';
import { parseLeetcodeMetaData, type HarnessSpec } from '../src/judge/harness/spec.js';

const execFileP = promisify(execFile);

async function hasJava(): Promise<boolean> {
  // macOS 上常见 java 1.8 stub 不识别 --version,改用 -version
  try {
    await execFileP('javac', ['-version']);
    await execFileP('java', ['-version']);
    return true;
  } catch {
    return false;
  }
}

function runJava(cwd: string, stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const ch = spawn('java', ['-cp', '.', 'Harness'], { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let so = '';
    let se = '';
    ch.stdout.on('data', (b) => (so += b.toString()));
    ch.stderr.on('data', (b) => (se += b.toString()));
    ch.once('close', (code) => resolve({ stdout: so, stderr: se, exitCode: code ?? -1 }));
    ch.stdin.write(stdin);
    ch.stdin.end();
  });
}

async function compileAndRunJava(solution: string, harness: string, stdin: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oja-harness-java-'));
  await fs.writeFile(path.join(dir, 'Solution.java'), solution, 'utf-8');
  await fs.writeFile(path.join(dir, 'Harness.java'), harness, 'utf-8');
  try {
    await execFileP('javac', ['Solution.java', 'Harness.java'], { cwd: dir });
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return { compileOk: false, compileErr: err.stderr ?? err.message ?? '', stdout: '', stderr: '', exitCode: -1 };
  }
  const res = await runJava(dir, stdin);
  await fs.rm(dir, { recursive: true, force: true });
  return { compileOk: true, compileErr: '', ...res };
}

test('java: 拒绝 unsupported', () => {
  assert.throws(() => generateJavaHarness({ kind: 'unsupported', reason: 'systemdesign' }));
});

test('java: 生成代码含必要结构(twoSum)', () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "twoSum",
    "params": [{"name":"nums","type":"integer[]"},{"name":"target","type":"integer"}],
    "return": {"type": "integer[]"}
  }`);
  const src = generateJavaHarness(spec);
  assert.match(src, /public class Harness/);
  assert.match(src, /public static void main/);
  assert.match(src, /int\[\] nums = Parser\.parseIntArray/);
  assert.match(src, /int target = Parser\.parseInt/);
  assert.match(src, /sol\.twoSum\(nums, target\)/);
  assert.match(src, /Writer\.intArray/);
  // Java 端 ListNode/TreeNode 始终注入(parser/writer 内部引用,与是否用到无关)
});

test('java: ListNode 题注入 ListNode 定义和 dump', () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "reverseList",
    "params": [{"name":"head","type":"ListNode"}],
    "return": {"type": "ListNode"}
  }`);
  const src = generateJavaHarness(spec);
  assert.match(src, /class ListNode/);
  assert.match(src, /Parser\.parseListNode/);
  assert.match(src, /Writer\.dumpListNode/);
});

test('java: TreeNode 题注入 TreeNode 定义和 dump', () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "invertTree",
    "params": [{"name":"root","type":"TreeNode"}],
    "return": {"type": "TreeNode"}
  }`);
  const src = generateJavaHarness(spec);
  assert.match(src, /class TreeNode/);
  assert.match(src, /Parser\.parseTreeNode/);
  assert.match(src, /Writer\.dumpTreeNode/);
});

test('java e2e twoSum', { skip: !(await hasJava()) }, async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "twoSum",
    "params": [{"name":"nums","type":"integer[]"},{"name":"target","type":"integer"}],
    "return": {"type": "integer[]"}
  }`);
  const harness = generateJavaHarness(spec);
  const solution = `import java.util.*;
class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> m = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            if (m.containsKey(target - nums[i])) return new int[]{m.get(target - nums[i]), i};
            m.put(nums[i], i);
        }
        return new int[0];
    }
}`;
  const cases: Array<[string, string]> = [
    ['[2,7,11,15]\n9', '[0,1]'],
    ['[3,2,4]\n6', '[1,2]'],
    ['[3,3]\n6', '[0,1]'],
  ];
  for (const [input, expected] of cases) {
    const r = await compileAndRunJava(solution, harness, input);
    assert.ok(r.compileOk, `compile failed:\n${r.compileErr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('java e2e reverseList', { skip: !(await hasJava()) }, async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "reverseList",
    "params": [{"name":"head","type":"ListNode"}],
    "return": {"type": "ListNode"}
  }`);
  const harness = generateJavaHarness(spec);
  const solution = `class Solution {
    public ListNode reverseList(ListNode head) {
        ListNode prev = null;
        while (head != null) {
            ListNode nxt = head.next;
            head.next = prev;
            prev = head;
            head = nxt;
        }
        return prev;
    }
}`;
  const cases: Array<[string, string]> = [
    ['[1,2,3,4,5]', '[5,4,3,2,1]'],
    ['[1,2]', '[2,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const r = await compileAndRunJava(solution, harness, input);
    assert.ok(r.compileOk, `compile failed:\n${r.compileErr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('java e2e invertTree', { skip: !(await hasJava()) }, async () => {
  const spec = parseLeetcodeMetaData(`{
    "name": "invertTree",
    "params": [{"name":"root","type":"TreeNode"}],
    "return": {"type": "TreeNode"}
  }`);
  const harness = generateJavaHarness(spec);
  const solution = `class Solution {
    public TreeNode invertTree(TreeNode root) {
        if (root == null) return null;
        TreeNode t = root.left;
        root.left = root.right;
        root.right = t;
        invertTree(root.left);
        invertTree(root.right);
        return root;
    }
}`;
  const cases: Array<[string, string]> = [
    ['[4,2,7,1,3,6,9]', '[4,7,2,9,6,3,1]'],
    ['[2,1,3]', '[2,3,1]'],
    ['[]', '[]'],
  ];
  for (const [input, expected] of cases) {
    const r = await compileAndRunJava(solution, harness, input);
    assert.ok(r.compileOk, `compile failed:\n${r.compileErr}`);
    assert.equal(r.stdout.trim(), expected);
  }
});

test('java e2e 基础类型: string/bool/double', { skip: !(await hasJava()) }, async () => {
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
  const harness = generateJavaHarness(spec);
  const solution = `class Solution {
    public String echo(String s, boolean b, double d) {
        return s + ":" + (b ? "T" : "F") + ":" + (int)(d * 10);
    }
}`;
  const r = await compileAndRunJava(solution, harness, '"hi"\ntrue\n3.5');
  assert.ok(r.compileOk, `compile failed:\n${r.compileErr}`);
  assert.equal(r.stdout.trim(), '"hi:T:35"');
});
