import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { NoopLogger } from '../src/logger/logger.js';

test('NoopLogger: 所有方法都不抛错', () => {
  const lg = new NoopLogger();
  lg.info('workspace', 'hello');
  lg.info('judge', 'hello', { foo: 1 });
  lg.warn('http', 'warn');
  lg.error('platform.hdoj', 'err', new Error('x'));
  // 应不写入任何输出 — 此处仅断言不抛
  assert.ok(true);
});
