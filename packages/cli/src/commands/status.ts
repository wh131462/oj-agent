/**
 * oja status:展示登录状态、backend、config 路径、工具链摘要、版本。
 */
import type { CommandModule } from './types.js';
import { renderTable } from '../render/table.js';
import { ansiEnabled } from '../utils/globals.js';
import { colorize } from '../render/ansi.js';
import type { PlatformId } from '@oj-agent/core';

const VERSION = '0.1.0';
const PLATFORMS: PlatformId[] = ['leetcode-cn', 'hdoj', 'codeforces', 'luogu', 'poj', 'lanqiao'];

export const statusCommand: CommandModule = {
  name: 'status',
  description: '查看登录状态、配置与工具链',
  help() {
    return 'oja status [--json]';
  },
  async run(ctx, _args) {
    const ansi = ansiEnabled(ctx.globals);

    const platforms: Record<string, { status: string; username?: string }> = {};
    for (const p of PLATFORMS) {
      const cred = await ctx.credentialStore.get(p);
      const hasCred = !!(cred?.cookie || cred?.token);
      if (!hasCred) {
        platforms[p] = { status: 'unauthenticated' };
        continue;
      }
      const s = await ctx.credChecker.check(p);
      platforms[p] = {
        status: s,
        username: cred.extra?.username,
      };
    }

    const toolchain = await ctx.toolchain.probe();

    if (ctx.globals.json) {
      const payload = {
        version: VERSION,
        configPath: ctx.configPath,
        secretBackend: ctx.secretInfo.kind,
        secretFile: ctx.secretInfo.filePath,
        platforms,
        toolchain: Object.fromEntries(
          Object.entries(toolchain).map(([k, v]) => [k, v ? { path: v.path, version: v.version } : null]),
        ),
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      return 0;
    }

    // 人类输出
    const out: string[] = [];
    out.push(colorize(ansi, 'bold', `oja v${VERSION}`));
    out.push('');
    out.push(`Config:  ${ctx.configPath}`);
    out.push(
      `Secrets: ${ctx.secretInfo.kind}${ctx.secretInfo.filePath ? ' (' + ctx.secretInfo.filePath + ')' : ''}`,
    );
    out.push('');
    out.push(colorize(ansi, 'bold', 'Platforms:'));
    for (const [p, info] of Object.entries(platforms)) {
      const badge =
        info.status === 'valid'
          ? colorize(ansi, 'green', '✓')
          : info.status === 'expired'
            ? colorize(ansi, 'yellow', '⚠')
            : colorize(ansi, 'gray', '✗');
      const userPart = info.username ? ` (${info.username})` : '';
      out.push(`  ${badge} ${p}: ${info.status}${userPart}`);
    }
    out.push('');
    out.push(colorize(ansi, 'bold', 'Toolchain:'));
    const rows: string[][] = [];
    for (const [k, v] of Object.entries(toolchain)) {
      rows.push([k, v ? colorize(ansi, 'green', '✓') : colorize(ansi, 'gray', '✗'), v?.path ?? '-', v?.version ?? '-']);
    }
    out.push(
      renderTable(
        [{ header: 'tool' }, { header: 'ok' }, { header: 'path', maxWidth: 60 }, { header: 'version' }],
        rows,
      ),
    );
    process.stdout.write(out.join('\n') + '\n');
    return 0;
  },
};
