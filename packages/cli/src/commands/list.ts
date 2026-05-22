/**
 * oja list <platform> [--page N --size N --keyword X --difficulty X --tag X]
 */
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';
import { renderTable } from '../render/table.js';
import { ansiEnabled } from '../utils/globals.js';
import { colorize } from '../render/ansi.js';
import type { PlatformId, PlatformListQuery } from '@oj-agent/core';

const PLATFORMS: PlatformId[] = ['leetcode-cn', 'hdoj'];
const ALLOWED_DIFFICULTY = ['Easy', 'Medium', 'Hard'];

export const listCommand: CommandModule = {
  name: 'list',
  description: '列出题库',
  flags: {
    page: { type: 'number', default: 1 },
    size: { type: 'number', default: 20 },
    keyword: { type: 'string' },
    difficulty: { type: 'string' },
    tag: { type: 'string[]' },
  },
  help() {
    return [
      'oja list <platform> [options]',
      '',
      'Options:',
      '  --page N           页码(默认 1)',
      '  --size N           每页大小(默认 20)',
      '  --keyword X        按关键字筛选',
      '  --difficulty X     Easy / Medium / Hard',
      '  --tag X            按标签筛选(可多次)',
      '  --json             机器可读输出',
    ].join('\n');
  },
  async run(ctx, args) {
    const platform = args.positional[0] as PlatformId | undefined;
    if (!platform) throw new UsageError('缺少参数: <platform>');
    if (!PLATFORMS.includes(platform)) throw new UsageError(`未知平台: ${platform}`);
    const difficulty = args.flags.difficulty as string | undefined;
    if (difficulty && !ALLOWED_DIFFICULTY.includes(difficulty)) {
      throw new UsageError(`未知 difficulty: ${difficulty}(允许: ${ALLOWED_DIFFICULTY.join(' / ')})`);
    }
    const query: PlatformListQuery = {
      page: args.flags.page as number,
      pageSize: args.flags.size as number,
      keyword: (args.flags.keyword as string | undefined) || undefined,
      difficulty: difficulty || undefined,
      tags: (args.flags.tag as string[] | undefined)?.length
        ? (args.flags.tag as string[])
        : undefined,
    };
    const adapter = ctx.registry.get(platform);
    const items = await adapter.listProblems(query);

    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify(items, null, 2) + '\n');
      return 0;
    }

    const ansi = ansiEnabled(ctx.globals);
    const rows = items.map((p) => [
      p.id,
      p.title,
      formatDifficulty(p.difficulty, ansi),
      (p.tags ?? []).slice(0, 3).join(', '),
    ]);
    process.stdout.write(
      renderTable(
        [
          { header: 'ID' },
          { header: '标题', maxWidth: 50 },
          { header: '难度' },
          { header: '标签', maxWidth: 40 },
        ],
        rows,
      ) + '\n',
    );
    return 0;
  },
};

function formatDifficulty(d: string | undefined, ansi: boolean): string {
  if (!d) return '-';
  if (d === 'Easy') return colorize(ansi, 'green', d);
  if (d === 'Medium') return colorize(ansi, 'yellow', d);
  if (d === 'Hard') return colorize(ansi, 'red', d);
  return d;
}
