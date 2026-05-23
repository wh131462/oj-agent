import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { platformLoginConfigs } from '../src/auth/platform-login-configs.js';

test('platformLoginConfigs: leetcode-cn 至少含一个 ready 信号', () => {
  const cfg = platformLoginConfigs['leetcode-cn'];
  assert.ok(cfg);
  const r = cfg!.ready;
  const has = !!(r.urlPattern || r.cookieName || r.selector);
  assert.equal(has, true);
});

test('platformLoginConfigs: hdoj 至少含一个 ready 信号', () => {
  const cfg = platformLoginConfigs['hdoj'];
  assert.ok(cfg);
  const r = cfg!.ready;
  assert.ok(r.urlPattern || r.cookieName || r.selector);
});

test('platformLoginConfigs: 全部六个平台均已配置', () => {
  assert.ok(platformLoginConfigs['codeforces']);
  assert.ok(platformLoginConfigs['luogu']);
  assert.ok(platformLoginConfigs['poj']);
  assert.ok(platformLoginConfigs['lanqiao']);
});

test('platformLoginConfigs: extractUsername 是函数', () => {
  const lc = platformLoginConfigs['leetcode-cn']!;
  assert.equal(typeof lc.extractUsername, 'function');
});

test('platformLoginConfigs: leetcode-cn URL pattern 匹配登录后跳转', () => {
  const re = platformLoginConfigs['leetcode-cn']!.ready.urlPattern!;
  assert.match('https://leetcode.cn/problemset/all/', re);
  assert.match('https://leetcode.cn/u/foo/', re);
  // 不应匹配登录页本身
  assert.equal(re.test('https://leetcode.cn/accounts/login/'), false);
});
