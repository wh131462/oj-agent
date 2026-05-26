/**
 * HarnessSpec / metaData 归一化测试。
 *
 * metaData 样本均来自真实 LeetCode GraphQL 响应，覆盖：
 *   - 普通函数（twoSum）
 *   - 单参 ListNode / TreeNode
 *   - 二维数组
 *   - systemdesign（LRUCache）
 *   - 不支持的类型
 *   - 各种解析失败
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseLeetcodeMetaData, parseTypeString, typeToString } from '../src/judge/harness/spec.js';

test('parseTypeString: 基础标量', () => {
  assert.deepEqual(parseTypeString('integer'), { tag: 'int' });
  assert.deepEqual(parseTypeString('long'), { tag: 'long' });
  assert.deepEqual(parseTypeString('double'), { tag: 'double' });
  assert.deepEqual(parseTypeString('boolean'), { tag: 'bool' });
  assert.deepEqual(parseTypeString('string'), { tag: 'string' });
  assert.deepEqual(parseTypeString('character'), { tag: 'char' });
  assert.deepEqual(parseTypeString('void'), { tag: 'void' });
});

test('parseTypeString: 一维数组', () => {
  assert.deepEqual(parseTypeString('integer[]'), { tag: 'array', elem: { tag: 'int' } });
  assert.deepEqual(parseTypeString('string[]'), { tag: 'array', elem: { tag: 'string' } });
  assert.deepEqual(parseTypeString('character[]'), { tag: 'array', elem: { tag: 'char' } });
});

test('parseTypeString: 二维数组递归剥离', () => {
  assert.deepEqual(parseTypeString('integer[][]'), {
    tag: 'array',
    elem: { tag: 'array', elem: { tag: 'int' } },
  });
});

test('parseTypeString: list<X> 等价于 X[]', () => {
  assert.deepEqual(parseTypeString('list<integer>'), { tag: 'array', elem: { tag: 'int' } });
  assert.deepEqual(parseTypeString('List<String>'), { tag: 'array', elem: { tag: 'string' } });
});

test('parseTypeString: ListNode / TreeNode', () => {
  assert.deepEqual(parseTypeString('ListNode'), { tag: 'listnode' });
  assert.deepEqual(parseTypeString('TreeNode'), { tag: 'treenode' });
});

test('parseTypeString: 未知类型返回 undefined', () => {
  assert.equal(parseTypeString('NestedInteger'), undefined);
  assert.equal(parseTypeString('Interval'), undefined);
  assert.equal(parseTypeString(''), undefined);
});

test('typeToString: 与 parseTypeString 互逆', () => {
  const cases = ['integer', 'integer[]', 'integer[][]', 'string[]', 'ListNode', 'TreeNode', 'boolean'];
  for (const s of cases) {
    const t = parseTypeString(s);
    assert.ok(t, `parse ${s}`);
    assert.equal(typeToString(t!), s);
  }
});

// ---------- parseLeetcodeMetaData ----------

const META_TWO_SUM = `{
  "name": "twoSum",
  "params": [
    { "name": "nums", "type": "integer[]" },
    { "name": "target", "type": "integer" }
  ],
  "return": { "type": "integer[]", "size": 2 }
}`;

const META_REVERSE_LIST = `{
  "name": "reverseList",
  "params": [
    { "name": "head", "type": "ListNode", "dealloc": false }
  ],
  "return": { "type": "ListNode", "dealloc": true }
}`;

const META_INVERT_TREE = `{
  "name": "invertTree",
  "params": [{ "name": "root", "type": "TreeNode" }],
  "return": { "type": "TreeNode" }
}`;

const META_LRU = `{
  "classname": "LRUCache",
  "constructor": { "params": [{ "type": "integer", "name": "capacity" }] },
  "methods": [],
  "systemdesign": true
}`;

test('parseLeetcodeMetaData: twoSum', () => {
  const spec = parseLeetcodeMetaData(META_TWO_SUM);
  assert.equal(spec.kind, 'function');
  if (spec.kind !== 'function') return;
  assert.equal(spec.funcName, 'twoSum');
  assert.equal(spec.params.length, 2);
  assert.deepEqual(spec.params[0], {
    name: 'nums',
    type: { tag: 'array', elem: { tag: 'int' } },
  });
  assert.deepEqual(spec.params[1], { name: 'target', type: { tag: 'int' } });
  assert.deepEqual(spec.returnType, { tag: 'array', elem: { tag: 'int' } });
});

test('parseLeetcodeMetaData: ListNode 题', () => {
  const spec = parseLeetcodeMetaData(META_REVERSE_LIST);
  assert.equal(spec.kind, 'function');
  if (spec.kind !== 'function') return;
  assert.deepEqual(spec.params[0]!.type, { tag: 'listnode' });
  assert.deepEqual(spec.returnType, { tag: 'listnode' });
});

test('parseLeetcodeMetaData: TreeNode 题', () => {
  const spec = parseLeetcodeMetaData(META_INVERT_TREE);
  assert.equal(spec.kind, 'function');
  if (spec.kind !== 'function') return;
  assert.deepEqual(spec.params[0]!.type, { tag: 'treenode' });
});

test('parseLeetcodeMetaData: systemdesign 标记返回 unsupported', () => {
  const spec = parseLeetcodeMetaData(META_LRU);
  assert.equal(spec.kind, 'unsupported');
  if (spec.kind !== 'unsupported') return;
  assert.equal(spec.reason, 'systemdesign');
});

test('parseLeetcodeMetaData: 含 classname 即视为 systemdesign', () => {
  // 即便没有 systemdesign:true，只要有 classname 就当 design 题处理
  const spec = parseLeetcodeMetaData('{"classname":"MyStack","constructor":{"params":[]}}');
  assert.equal(spec.kind, 'unsupported');
});

test('parseLeetcodeMetaData: 未知类型', () => {
  const spec = parseLeetcodeMetaData(
    '{"name":"f","params":[{"name":"x","type":"NestedInteger"}],"return":{"type":"void"}}',
  );
  assert.equal(spec.kind, 'unsupported');
  if (spec.kind !== 'unsupported') return;
  assert.equal(spec.reason, 'unknown-type');
  assert.equal(spec.detail, 'NestedInteger');
});

test('parseLeetcodeMetaData: 空 / 非法 JSON', () => {
  assert.equal(parseLeetcodeMetaData('').kind, 'unsupported');
  assert.equal(parseLeetcodeMetaData('   ').kind, 'unsupported');
  assert.equal(parseLeetcodeMetaData('not-json').kind, 'unsupported');
  assert.equal(parseLeetcodeMetaData('[]').kind, 'unsupported');
});

test('parseLeetcodeMetaData: 缺字段', () => {
  assert.equal(parseLeetcodeMetaData('{}').kind, 'unsupported');
  assert.equal(parseLeetcodeMetaData('{"name":"f"}').kind, 'unsupported');
  assert.equal(parseLeetcodeMetaData('{"name":"f","params":[]}').kind, 'unsupported');
});
