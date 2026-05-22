/**
 * status-bar 文本切换序列纯逻辑测试。
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

interface FakeItem {
  text: string;
  background: string | undefined;
}

class FakeStatusBar {
  item: FakeItem = { text: '', background: undefined };
  setIdle(): void { this.item.text = '$(rocket) OJ-Agent'; this.item.background = undefined; }
  setSubmitting(): void { this.item.text = '$(sync~spin) 提交中...'; }
  setJudging(): void { this.item.text = '$(sync~spin) Judging...'; }
  setVerdict(v: string, ms?: number): void {
    const icon = v === 'AC' ? '$(check)' : '$(error)';
    this.item.text = `${icon} ${v}${ms !== undefined ? ' ' + ms + 'ms' : ''}`;
    this.item.background = v === 'AC' ? undefined : 'error-bg';
  }
}

test('onProgress 序列:pre-check → submitting → judging → AC', () => {
  const sb = new FakeStatusBar();
  const seq: string[] = [];
  sb.setIdle();           seq.push(sb.item.text);
  sb.setSubmitting();     seq.push(sb.item.text);
  sb.setJudging();        seq.push(sb.item.text);
  sb.setVerdict('AC', 120); seq.push(sb.item.text);
  assert.deepEqual(seq, [
    '$(rocket) OJ-Agent',
    '$(sync~spin) 提交中...',
    '$(sync~spin) Judging...',
    '$(check) AC 120ms',
  ]);
});

test('WA verdict 设置 error background', () => {
  const sb = new FakeStatusBar();
  sb.setVerdict('WA');
  assert.equal(sb.item.text, '$(error) WA');
  assert.equal(sb.item.background, 'error-bg');
});

test('AC verdict 不带 error background', () => {
  const sb = new FakeStatusBar();
  sb.setVerdict('AC', 50);
  assert.equal(sb.item.background, undefined);
});
