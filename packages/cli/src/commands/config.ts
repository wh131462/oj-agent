/**
 * oja config get [<key>] | set <key> <value> | unset <key> | list [--json]
 */
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';
import { listConfigKeys, getConfigSpec } from '@oj-agent/core';

export const configCommand: CommandModule = {
  name: 'config',
  description: '读 / 写 CLI 配置(TOML)',
  help() {
    return [
      'oja config get [<key>]',
      'oja config set <key> <value>',
      'oja config unset <key>',
      'oja config list [--json]',
      '',
      '不传 key 时 `get` 输出完整快照(JSON)。',
      '`list` 显示 schema 中所有已知键及其当前值。',
    ].join('\n');
  },
  async run(ctx, args) {
    const sub = args.positional[0];
    if (!sub) throw new UsageError('缺少子命令: get / set / unset / list');

    if (sub === 'get') {
      const key = args.positional[1];
      if (!key) {
        const snap = await ctx.config.snapshot();
        process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
        return 0;
      }
      const v = await ctx.config.getRaw(key);
      if (v === undefined) {
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
      if (!key || value === undefined)
        throw new UsageError('用法: oja config set <key> <value>');
      await ctx.config.setFromString(key, value);
      if (ctx.globals.json) {
        process.stdout.write(JSON.stringify({ ok: true, key, value }) + '\n');
      } else {
        process.stderr.write(`✓ ${key} = ${value}\n`);
      }
      return 0;
    }

    if (sub === 'unset') {
      const key = args.positional[1];
      if (!key) throw new UsageError('用法: oja config unset <key>');
      const spec = getConfigSpec(key);
      if (!spec) throw new UsageError(`未知配置键: ${key}`);
      const def = spec.default;
      const restored =
        def === undefined
          ? spec.type === 'array'
            ? '[]'
            : ''
          : spec.type === 'array'
            ? JSON.stringify(def)
            : String(def);
      await ctx.config.setFromString(key, restored);
      if (ctx.globals.json) {
        process.stdout.write(
          JSON.stringify({ ok: true, key, restored: true }) + '\n',
        );
      } else {
        process.stderr.write(`✓ ${key} 已重置为默认值\n`);
      }
      return 0;
    }

    if (sub === 'list') {
      const keys = listConfigKeys();
      const entries: Array<{
        key: string;
        value: unknown;
        default: unknown;
        sensitive: boolean;
      }> = [];
      for (const key of keys) {
        const spec = getConfigSpec(key)!;
        const raw = await ctx.config.getRaw(key);
        const value = raw === undefined ? spec.default : raw;
        entries.push({
          key,
          value: spec.sensitive ? '***' : value,
          default: spec.default,
          sensitive: spec.sensitive ?? false,
        });
      }
      if (ctx.globals.json) {
        process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
      } else {
        for (const e of entries) {
          const v = formatValue(e.value);
          process.stdout.write(`${e.key.padEnd(38)} ${v}\n`);
        }
      }
      return 0;
    }

    throw new UsageError(`未知子命令: ${sub}`);
  },
};

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '-';
  if (typeof v === 'string') return v === '' ? '""' : v;
  return JSON.stringify(v);
}
