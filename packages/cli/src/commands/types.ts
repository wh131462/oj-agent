/**
 * 命令通用类型。
 */
import type { CliContext } from '../context.js';
import type { FlagsSpec, ParsedArgs } from '../utils/args.js';

export interface CommandModule {
  /** 命令名,如 'login'。 */
  name: string;
  /** 简短描述。 */
  description: string;
  /** 命令独有的 flag schema(全局 flags 已在外层解析)。 */
  flags?: FlagsSpec;
  /** 帮助文本。返回多行字符串(不含末尾换行)。 */
  help(): string;
  /** 主入口。返回退出码。 */
  run(ctx: CliContext, args: ParsedArgs): Promise<number>;
}
