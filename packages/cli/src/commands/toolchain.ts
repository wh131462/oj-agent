/**
 * oja toolchain [--refresh]:列出工具链。
 */
import type { CommandModule } from './types.js';
import { renderTable } from '../render/table.js';
import { ansiEnabled } from '../utils/globals.js';
import { colorize } from '../render/ansi.js';

export const toolchainCommand: CommandModule = {
  name: 'toolchain',
  description: '探测本地编译器 / 解释器工具链',
  flags: {
    refresh: { type: 'boolean', default: false },
  },
  help() {
    return 'oja toolchain [--refresh] [--json]';
  },
  async run(ctx, args) {
    const refresh = Boolean(args.flags.refresh);
    if (refresh) ctx.toolchain.reset();
    const snap = await ctx.toolchain.probe();

    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
    } else {
      const ansi = ansiEnabled(ctx.globals);
      const rows: string[][] = [];
      for (const [k, v] of Object.entries(snap)) {
        rows.push([
          k,
          v ? colorize(ansi, 'green', '✓') : colorize(ansi, 'gray', '✗'),
          v?.path ?? '-',
          v?.version ?? '-',
        ]);
      }
      process.stdout.write(
        renderTable(
          [
            { header: 'tool' },
            { header: 'ok' },
            { header: 'path', maxWidth: 60 },
            { header: 'version' },
          ],
          rows,
        ) + '\n',
      );
    }

    // 退出码:若关键工具(node)缺失返回 3
    if (!snap.node) return 3;
    return 0;
  },
};
