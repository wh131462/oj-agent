/**
 * oja platforms：输出所有平台的能力矩阵 + 降级提示。
 */
import type { CommandModule } from './types.js';
import { renderTable } from '../render/table.js';
import type { PlatformId } from '@oj-agent/core';

const PLATFORMS: PlatformId[] = [
  'leetcode-cn',
  'hdoj',
  'codeforces',
  'luogu',
  'poj',
  'lanqiao',
];

export const platformsCommand: CommandModule = {
  name: 'platforms',
  description: '查看各 OJ 平台的能力矩阵',
  help() {
    return [
      'oja platforms [--json]',
      '',
      '输出每个平台的 listProblems / getProblem / submit / pollResult 能力，',
      '以及已声明的降级（degraded）说明。',
    ].join('\n');
  },
  async run(ctx) {
    const entries = PLATFORMS.map((id) => {
      const adapter = ctx.registry.get(id);
      return {
        id,
        capabilities: adapter.capabilities,
        degraded: adapter.degraded ?? [],
      };
    });

    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      return 0;
    }

    const rows = entries.map((e) => [
      e.id,
      yes(e.capabilities.listProblems),
      yes(e.capabilities.getProblem),
      yes(e.capabilities.submit),
      yes(e.capabilities.pollResult),
      yes(e.capabilities.autoLogin),
      e.degraded.length > 0 ? '⚠ 见下方' : '',
    ]);
    process.stdout.write(
      renderTable(
        [
          { header: '平台' },
          { header: 'list' },
          { header: 'detail' },
          { header: 'submit' },
          { header: 'poll' },
          { header: 'auto-login' },
          { header: '降级' },
        ],
        rows,
      ) + '\n',
    );

    // 降级详情
    for (const e of entries) {
      if (e.degraded.length === 0) continue;
      process.stdout.write(`\n[${e.id}] 降级说明:\n`);
      for (const d of e.degraded) {
        process.stdout.write(`  - ${d.capability}: ${d.reason}\n`);
        if (d.hint) process.stdout.write(`    提示: ${d.hint}\n`);
      }
    }
    return 0;
  },
};

function yes(v: boolean): string {
  return v ? '✓' : '-';
}
