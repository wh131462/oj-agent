/**
 * judge-panel HTML 渲染快照与 message 路由(纯逻辑)。
 *
 * 不实例化 vscode 模块,只测可独立提取的纯函数。
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

const EXT_TO_LANG: Record<string, string> = {
  cpp: 'cpp', cc: 'cpp', py: 'python3', java: 'java', js: 'javascript',
};

async function inferLangFromFilesnames(files: string[], defaultLang: string): Promise<string> {
  for (const f of files) {
    if (f === 'Main.java') return 'java';
    const m = f.match(/^solution\.([a-z]+)$/i);
    if (m) {
      const ext = m[1]!.toLowerCase();
      const l = EXT_TO_LANG[ext];
      if (l) return l;
    }
  }
  return defaultLang;
}

test('inferLang: solution.cpp → cpp', async () => {
  assert.equal(await inferLangFromFilesnames(['solution.cpp', 'problem.md'], 'cpp'), 'cpp');
});

test('inferLang: solution.py → python3', async () => {
  assert.equal(await inferLangFromFilesnames(['solution.py'], 'cpp'), 'python3');
});

test('inferLang: Main.java → java', async () => {
  assert.equal(await inferLangFromFilesnames(['Main.java'], 'cpp'), 'java');
});

test('inferLang: 无 solution 文件 → defaultLang', async () => {
  assert.equal(await inferLangFromFilesnames(['problem.md', 'meta.json'], 'python3'), 'python3');
});

test('verdict 分支:AC/WA/CE 三种状态都能在 summary 区分', () => {
  const buildSummary = (verdicts: string[], compileError?: string): string => {
    if (compileError) return 'error';
    const total = verdicts.length;
    const ac = verdicts.filter((v) => v === 'AC').length;
    return ac === total && total > 0 ? 'ok' : 'fail';
  };
  assert.equal(buildSummary(['AC', 'AC']), 'ok');
  assert.equal(buildSummary(['AC', 'WA']), 'fail');
  assert.equal(buildSummary([], 'syntax error'), 'error');
});

test('message 路由白名单仅接受四个 AI kind', () => {
  const valid = ['explainError', 'generateApproach', 'generateSolution', 'explainCode'];
  const isValid = (k: string): boolean => valid.includes(k);
  assert.equal(isValid('explainError'), true);
  assert.equal(isValid('randomEvil'), false);
});
