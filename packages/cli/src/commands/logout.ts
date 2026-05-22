/**
 * oja logout <platform>:删除该平台凭证,幂等。
 */
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';
import { colorize } from '../render/ansi.js';
import { ansiEnabled } from '../utils/globals.js';

export const logoutCommand: CommandModule = {
  name: 'logout',
  description: '注销指定 OJ 平台',
  help() {
    return 'oja logout <platform>';
  },
  async run(ctx, args) {
    const platform = args.positional[0];
    if (!platform) throw new UsageError('缺少参数: <platform>');
    if (platform !== 'leetcode-cn' && platform !== 'hdoj') {
      throw new UsageError(`未知平台: ${platform}`);
    }
    await ctx.credentialStore.delete(platform);
    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify({ ok: true, platform }) + '\n');
    } else {
      const ansi = ansiEnabled(ctx.globals);
      process.stderr.write(colorize(ansi, 'green', `✓ ${platform} 已注销\n`));
    }
    return 0;
  },
};
