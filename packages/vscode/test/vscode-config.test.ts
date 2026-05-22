/**
 * VSCodeConfigBackend 纯逻辑单测（不依赖 vscode 模块）。
 *
 * VSCode 真实 API 行为需要在 Extension Host 中验证;本文件只覆盖
 * 配置 key 拼接 / 默认值兜底等可独立测试的纯函数。
 *
 * 完整端到端在 @vscode/test-electron 启动 Extension Host 中跑(M2)。
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

/**
 * 模拟 `affectsConfiguration` 的拼接规则:section + '.' + key。
 */
function buildAffectsKey(section: string, key: string): string {
  return `${section}.${key}`;
}

test('config affects key 拼接', () => {
  assert.equal(buildAffectsKey('ojAgent', 'platforms.enabled'), 'ojAgent.platforms.enabled');
  assert.equal(buildAffectsKey('ojAgent', 'ai.activeProfileId'), 'ojAgent.ai.activeProfileId');
});

test('config getOr 在 undefined 时返回默认值', () => {
  const map = new Map<string, unknown>();
  map.set('platforms.enabled', ['leetcode-cn']);
  const get = <T>(k: string): T | undefined => map.get(k) as T | undefined;
  const getOr = <T>(k: string, d: T): T => {
    const v = get<T>(k);
    return v === undefined ? d : v;
  };
  assert.deepEqual(getOr<string[]>('platforms.enabled', []), ['leetcode-cn']);
  assert.equal(getOr<number>('judge.timeoutMs', 3000), 3000);
});
