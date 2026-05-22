/**
 * oja config get <key>  /  oja config set <key> <value>
 */
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';

export const configCommand: CommandModule = {
  name: 'config',
  description: '读 / 写 CLI 配置(TOML)',
  help() {
    return [
      'oja config get [<key>]',
      'oja config set <key> <value>',
      '',
      '不传 key 时 `get` 输出完整快照(JSON)。',
    ].join('\n');
  },
  async run(ctx, args) {
    const sub = args.positional[0];
    if (!sub) throw new UsageError('缺少子命令: get / set');
    if (sub === 'get') {
      const key = args.positional[1];
      if (!key) {
        const snap = await ctx.config.snapshot();
        process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
        return 0;
      }
      const v = await ctx.config.getRaw(key);
      if (v === undefined) {
        // 应用 schema default
        const def = ctx.config.getWithDefault<unknown>(key, undefined);
        if (def === undefined) {
          throw new UsageError(`未知或未设置: ${key}`);
        }
        process.stdout.write(formatValue(def) + '\n');
        return 0;
      }
      process.stdout.write(formatValue(v) + '\n');
      return 0;
    }
    if (sub === 'set') {
      const key = args.positional[1];
      const value = args.positional[2];
      if (!key || value === undefined) throw new UsageError('用法: oja config set <key> <value>');
      await ctx.config.setFromString(key, value);
      if (ctx.globals.json) {
        process.stdout.write(JSON.stringify({ ok: true, key, value }) + '\n');
      } else {
        process.stderr.write(`✓ ${key} = ${value}\n`);
      }
      return 0;
    }
    throw new UsageError(`未知子命令: ${sub}`);
  },
};

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
