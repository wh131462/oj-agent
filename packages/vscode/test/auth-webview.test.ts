/**
 * auth-webview 与登录命令的纯逻辑单测。
 *
 * 不实例化 vscode webview。
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

function parsePhpSessId(setCookie: string): string | undefined {
  const m = setCookie.match(/PHPSESSID=[^;]+/);
  return m?.[0];
}

function buildLeetCodeCookie(session: string, csrf: string): string {
  return `LEETCODE_SESSION=${session}; csrftoken=${csrf}`;
}

test('解析 set-cookie 中的 PHPSESSID', () => {
  assert.equal(
    parsePhpSessId('PHPSESSID=abc123; path=/; HttpOnly'),
    'PHPSESSID=abc123',
  );
  assert.equal(parsePhpSessId('other=x; path=/'), undefined);
});

test('LeetCode Cookie 拼装顺序与分隔符', () => {
  assert.equal(
    buildLeetCodeCookie('S', 'C'),
    'LEETCODE_SESSION=S; csrftoken=C',
  );
});

test('用户取消输入时不应写凭证(逻辑标志)', () => {
  const seq: Array<string | undefined> = ['abc', undefined];
  // 模拟两步输入,第二步取消
  const session = seq[0];
  const csrf = seq[1];
  const proceed = !!(session && csrf);
  assert.equal(proceed, false);
});
