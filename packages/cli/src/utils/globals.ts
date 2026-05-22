/**
 * 全局 flag schema 与 CLI 选项归一化。
 */
import type { FlagsSpec } from './args.js';

export interface GlobalOptions {
  help: boolean;
  version: boolean;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  config?: string;
}

export const GLOBAL_FLAGS: FlagsSpec = {
  help: { type: 'boolean', alias: 'h', default: false, description: '显示帮助' },
  version: { type: 'boolean', alias: 'v', default: false, description: '显示版本' },
  json: { type: 'boolean', default: false, description: '机器可读 JSON 输出到 stdout' },
  quiet: { type: 'boolean', alias: 'q', default: false, description: '仅输出关键结果' },
  verbose: { type: 'boolean', default: false, description: '更多日志(含 scope)' },
  'no-color': { type: 'boolean', default: false, description: '禁用 ANSI' },
  config: { type: 'string', description: 'config 文件路径' },
};

export function pickGlobals(flags: Record<string, unknown>): GlobalOptions {
  return {
    help: Boolean(flags.help),
    version: Boolean(flags.version),
    json: Boolean(flags.json),
    quiet: Boolean(flags.quiet),
    verbose: Boolean(flags.verbose),
    noColor: Boolean(flags['no-color']),
    config: typeof flags.config === 'string' ? flags.config : undefined,
  };
}

/** ANSI 启用判定:--no-color 或 NO_COLOR 或非 TTY 时禁用。 */
export function ansiEnabled(g: GlobalOptions): boolean {
  if (g.noColor) return false;
  if (process.env.NO_COLOR) return false;
  if (g.json) return false;
  return Boolean(process.stdout.isTTY);
}
