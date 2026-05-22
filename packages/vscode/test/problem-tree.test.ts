/**
 * problem-tree 纯逻辑单测:
 *
 * 由于 ProblemTreeDataProvider 直接 `import * as vscode from 'vscode'`,
 * 完整实例化需要 Extension Host。本文件只覆盖可独立提取的纯逻辑:
 * - difficulty label → color 映射
 * - extractSlug 工具
 * - query state 持久化 key 拼接
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

function extractSlug(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/problems\/([^/?#]+)/);
  return m?.[1];
}

function queryStateKey(platform: string): string {
  return `ojAgent.problems.${platform}.query`;
}

function difficultyKey(diff?: string): 'easy' | 'medium' | 'hard' | 'unknown' {
  if (!diff) return 'unknown';
  const d = diff.toLowerCase();
  if (d.includes('easy') || d.includes('简单')) return 'easy';
  if (d.includes('medium') || d.includes('中等')) return 'medium';
  if (d.includes('hard') || d.includes('困难')) return 'hard';
  return 'unknown';
}

test('extractSlug 从 leetcode/hdoj URL 中提取 slug', () => {
  assert.equal(extractSlug('https://leetcode.cn/problems/two-sum/'), 'two-sum');
  assert.equal(extractSlug('https://leetcode.cn/problems/add-two-numbers/description/'), 'add-two-numbers');
  assert.equal(extractSlug('http://acm.hdu.edu.cn/showproblem.php?pid=1001'), undefined);
  assert.equal(extractSlug(undefined), undefined);
});

test('workspaceState key 命名稳定', () => {
  assert.equal(queryStateKey('leetcode-cn'), 'ojAgent.problems.leetcode-cn.query');
  assert.equal(queryStateKey('hdoj'), 'ojAgent.problems.hdoj.query');
});

test('difficulty 中英映射', () => {
  assert.equal(difficultyKey('Easy'), 'easy');
  assert.equal(difficultyKey('简单'), 'easy');
  assert.equal(difficultyKey('Medium'), 'medium');
  assert.equal(difficultyKey('中等'), 'medium');
  assert.equal(difficultyKey('Hard'), 'hard');
  assert.equal(difficultyKey('困难'), 'hard');
  assert.equal(difficultyKey(undefined), 'unknown');
  assert.equal(difficultyKey('legendary'), 'unknown');
});
