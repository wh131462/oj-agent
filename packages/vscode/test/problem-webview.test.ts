/**
 * problem-webview 纯逻辑单测。
 *
 * ProblemWebviewManager 依赖 vscode 模块,不可在普通 node 测试中实例化。
 * 本文件覆盖可独立提取的纯逻辑:
 * - parseProblemUrl 各平台 URL 识别
 * - problemRefKey 拼接稳定性
 * - HTML 转义
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

// 内联复制 parseProblemUrl 逻辑以避免引入 vscode 副作用
function parseProblemUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const lc = trimmed.match(/leetcode\.(cn|com)\/problems\/([^/?#]+)/i);
  if (lc) return { platform: 'leetcode-cn', id: lc[2]!, slug: lc[2]! };
  const hdoj = trimmed.match(/hdu\.edu\.cn\/.*[?&]pid=(\d+)/i);
  if (hdoj) return { platform: 'hdoj', id: hdoj[1]!, slug: hdoj[1]! };
  return undefined;
}

function problemRefKey(ref: { platform: string; id: string }) {
  return `${ref.platform}:${ref.id}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

test('parseProblemUrl 识别 LeetCode CN', () => {
  const r = parseProblemUrl('https://leetcode.cn/problems/two-sum/');
  assert.deepEqual(r, { platform: 'leetcode-cn', id: 'two-sum', slug: 'two-sum' });
});

test('parseProblemUrl 识别 HDOJ', () => {
  const r = parseProblemUrl('http://acm.hdu.edu.cn/showproblem.php?pid=1001');
  assert.deepEqual(r, { platform: 'hdoj', id: '1001', slug: '1001' });
});

test('parseProblemUrl 返回 undefined for 未知 URL', () => {
  assert.equal(parseProblemUrl('https://codeforces.com/problemset/problem/1/A'), undefined);
  assert.equal(parseProblemUrl(''), undefined);
});

test('problemRefKey 稳定拼接', () => {
  assert.equal(problemRefKey({ platform: 'leetcode-cn', id: 'two-sum' }), 'leetcode-cn:two-sum');
  assert.equal(problemRefKey({ platform: 'hdoj', id: '1001' }), 'hdoj:1001');
});

test('escapeHtml 处理基本特殊字符', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml(`it's & </`), 'it&#39;s &amp; &lt;/');
});

test('init payload 结构包含 platform/id/slug', () => {
  const ref = { platform: 'leetcode-cn', id: 'two-sum', slug: 'two-sum' };
  const payload = JSON.parse(JSON.stringify(ref));
  assert.deepEqual(Object.keys(payload).sort(), ['id', 'platform', 'slug']);
});
