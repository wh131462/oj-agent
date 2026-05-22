import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseArgs, UsageError } from '../src/utils/args.js';

test('parseArgs: 位置参数', () => {
  const r = parseArgs(['foo', 'bar'], {});
  assert.deepEqual(r.positional, ['foo', 'bar']);
});

test('parseArgs: --key value', () => {
  const r = parseArgs(['--page', '2'], { page: { type: 'number' } });
  assert.equal(r.flags.page, 2);
});

test('parseArgs: --key=value', () => {
  const r = parseArgs(['--page=3'], { page: { type: 'number' } });
  assert.equal(r.flags.page, 3);
});

test('parseArgs: 布尔 flag', () => {
  const r = parseArgs(['--json'], { json: { type: 'boolean', default: false } });
  assert.equal(r.flags.json, true);
});

test('parseArgs: --no-flag', () => {
  const r = parseArgs(['--no-json'], { json: { type: 'boolean', default: true } });
  assert.equal(r.flags.json, false);
});

test('parseArgs: string[] 多次累加', () => {
  const r = parseArgs(['--tag', 'a', '--tag', 'b'], { tag: { type: 'string[]' } });
  assert.deepEqual(r.flags.tag, ['a', 'b']);
});

test('parseArgs: 短名', () => {
  const r = parseArgs(['-h'], { help: { type: 'boolean', alias: 'h' } });
  assert.equal(r.flags.help, true);
});

test('parseArgs: -- 终止符', () => {
  const r = parseArgs(['--', '--foo', 'bar'], {});
  assert.deepEqual(r.positional, ['--foo', 'bar']);
});

test('parseArgs: 未知 flag 抛 UsageError', () => {
  assert.throws(() => parseArgs(['--unknown'], {}), UsageError);
});

test('parseArgs: 缺值 抛 UsageError', () => {
  assert.throws(() => parseArgs(['--page'], { page: { type: 'number' } }), UsageError);
});

test('parseArgs: 数字校验', () => {
  assert.throws(() => parseArgs(['--page', 'abc'], { page: { type: 'number' } }), UsageError);
});

test('parseArgs: 默认值', () => {
  const r = parseArgs([], { page: { type: 'number', default: 1 } });
  assert.equal(r.flags.page, 1);
});

test('parseArgs: 混合位置 + flag', () => {
  const r = parseArgs(['login', 'hdoj', '--cookie=x'], {
    cookie: { type: 'string' },
  });
  assert.deepEqual(r.positional, ['login', 'hdoj']);
  assert.equal(r.flags.cookie, 'x');
});
