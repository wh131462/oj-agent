import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ToolchainProbe } from '../src/judge/toolchain.js';

test('ToolchainProbe: 探测 node(应命中)', async () => {
  // CI 与本地都有 node
  const probe = new ToolchainProbe();
  const snap = await probe.probe();
  assert.ok(snap.node, 'node 应被探测到');
  assert.match(snap.node!.path, /node/);
  assert.match(snap.node!.version, /v?\d+\.\d+/);
});

test('ToolchainProbe: 5 分钟内的二次调用命中缓存(相等引用)', async () => {
  const probe = new ToolchainProbe();
  const a = await probe.probe();
  const b = await probe.probe();
  assert.equal(a, b);
});

test('ToolchainProbe: 显式 force=true 重新探测', async () => {
  const probe = new ToolchainProbe();
  const a = await probe.probe();
  const b = await probe.probe(true);
  assert.notEqual(a, b);
  // 内容大致一致
  assert.equal(!!a.node, !!b.node);
});

test('ToolchainProbe: reset() 后下次调用不命中缓存', async () => {
  const probe = new ToolchainProbe();
  const a = await probe.probe();
  probe.reset();
  const b = await probe.probe();
  assert.notEqual(a, b);
});

test('ToolchainProbe: 缺失工具返回 null,不抛错', async () => {
  const probe = new ToolchainProbe();
  const snap = await probe.probe();
  // 至少有一个不存在的工具应为 null(此处只确保结构)
  for (const v of Object.values(snap)) {
    if (v !== null) {
      assert.ok(v.path);
      assert.ok(typeof v.version === 'string');
    }
  }
});
