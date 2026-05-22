/**
 * TAP 14 风格输出。
 */

import type { JudgeCaseResult } from '@oj-agent/core';

export interface EmitTapOptions {
  /** stream,默认 process.stdout。 */
  out?: NodeJS.WritableStream;
}

export function emitTAP(cases: JudgeCaseResult[], opts: EmitTapOptions = {}): void {
  const stream = opts.out ?? process.stdout;
  const w = (s: string) => stream.write(s + '\n');
  w('TAP version 14');
  w(`1..${cases.length}`);
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const ok = c.verdict === 'AC';
    if (ok) passed++;
    else failed++;
    const status = ok ? 'ok' : 'not ok';
    const desc = `${status} ${c.index} - case ${c.index} (${c.timeMs}ms, ${c.verdict})`;
    w(desc);
    if (!ok) {
      w('  ---');
      w('  verdict: ' + c.verdict);
      w('  expected: |');
      for (const line of (c.expected ?? '').split('\n')) w('    ' + line);
      w('  actual: |');
      for (const line of c.stdout.split('\n')) w('    ' + line);
      if (c.stderr) {
        w('  stderr: |');
        for (const line of c.stderr.split('\n')) w('    ' + line);
      }
      if (c.diff?.unifiedDiff) {
        w('  diff: |');
        for (const line of c.diff.unifiedDiff.split('\n')) w('    ' + line);
      }
      w('  ...');
    }
  }
  w(`# ${passed} passed, ${failed} failed`);
}
