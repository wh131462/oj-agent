/**
 * CLI 主入口。子命令分发 + 全局错误处理。
 */

import { AdapterError } from '@oj-agent/core';
import { parseArgs, UsageError, type FlagsSpec } from './utils/args.js';
import { GLOBAL_FLAGS, pickGlobals } from './utils/globals.js';
import { createContext } from './context.js';
import type { CommandModule } from './commands/types.js';

import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { statusCommand } from './commands/status.js';
import { listCommand } from './commands/list.js';
import { pullCommand } from './commands/pull.js';
import { testCommand } from './commands/test.js';
import { submitCommand } from './commands/submit.js';
import { configCommand } from './commands/config.js';
import { toolchainCommand } from './commands/toolchain.js';

const VERSION = '0.1.0';

const COMMANDS: CommandModule[] = [
  loginCommand,
  logoutCommand,
  statusCommand,
  listCommand,
  pullCommand,
  testCommand,
  submitCommand,
  configCommand,
  toolchainCommand,
];

function rootHelp(): string {
  return [
    'oja - OJ Agent CLI',
    '',
    'Usage: oja <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(12)} ${c.description}`),
    '',
    'Global options:',
    '  -h, --help              显示帮助',
    '  -v, --version           显示版本',
    '      --json              JSON 输出',
    '      --quiet             仅输出关键结果',
    '      --verbose           更多日志',
    '      --no-color          禁用 ANSI',
    '      --config <path>     指定 config 文件',
    '',
    "Run 'oja <command> --help' for details.",
  ].join('\n');
}

export async function main(argv: string[]): Promise<number> {
  // 跳过 node + bin
  const args = argv.slice(2);

  // 第一遍只解析全局 flag(允许提前响应 --version / --help / 未指定命令)
  // 找出第一个非 flag token 作为命令名
  let cmdIndex = -1;
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t === '--') break;
    if (!t.startsWith('-')) {
      cmdIndex = i;
      break;
    }
    // 跳过 flag 的可能值
    if (t === '--config' && i + 1 < args.length) i++;
  }

  // 解析全局 flags(用合并后的 schema:目前没冲突)
  let globalArgs;
  try {
    globalArgs = parseArgs(cmdIndex === -1 ? args : args.slice(0, cmdIndex), GLOBAL_FLAGS);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`usage: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  const globals = pickGlobals(globalArgs.flags);

  if (globals.version) {
    process.stdout.write(VERSION + '\n');
    return 0;
  }

  if (cmdIndex === -1 || globals.help) {
    process.stdout.write(rootHelp() + '\n');
    return 0;
  }

  const cmdName = args[cmdIndex]!;
  const cmd = COMMANDS.find((c) => c.name === cmdName);
  if (!cmd) {
    process.stderr.write(`未知子命令: ${cmdName}\n\n`);
    process.stdout.write(rootHelp() + '\n');
    return 2;
  }

  // 子命令的 args 是 cmdIndex 之后的全部 token
  const cmdArgsRaw = args.slice(cmdIndex + 1);

  // 合并 schema:全局 + 子命令
  const mergedSchema: FlagsSpec = { ...GLOBAL_FLAGS, ...(cmd.flags ?? {}) };

  let parsed;
  try {
    parsed = parseArgs(cmdArgsRaw, mergedSchema);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`usage: oja ${cmd.name}: ${e.message}\n\n`);
      process.stdout.write(cmd.help() + '\n');
      return 2;
    }
    throw e;
  }
  // 子命令也支持全局 flag 在后(`oja status --json`)
  const localGlobals = pickGlobals({ ...globalArgs.flags, ...parsed.flags });

  if (localGlobals.help) {
    process.stdout.write(cmd.help() + '\n');
    return 0;
  }

  // 构造 context(对 toolchain / config 等命令 lazy 也无大碍)
  let ctx;
  try {
    ctx = await createContext(localGlobals);
  } catch (e) {
    process.stderr.write('启动失败: ' + (e as Error).message + '\n');
    return 3;
  }

  // SIGINT 处理
  const onSigint = () => {
    process.stderr.write('\n^C\n');
    process.exit(130);
  };
  process.on('SIGINT', onSigint);

  try {
    return await cmd.run(ctx, parsed);
  } catch (e) {
    process.off('SIGINT', onSigint);
    return handleError(e, localGlobals);
  } finally {
    process.off('SIGINT', onSigint);
  }
}

function handleError(e: unknown, globals: { verbose: boolean; json: boolean }): number {
  if (e instanceof UsageError) {
    process.stderr.write(`usage error: ${e.message}\n`);
    return 2;
  }
  if (e instanceof AdapterError) {
    if (globals.json) {
      process.stdout.write(
        JSON.stringify({ error: { code: e.code, message: e.message, retriable: e.retriable } }) + '\n',
      );
    } else {
      const hint = friendlyHint(e);
      process.stderr.write(`error[${e.code}]: ${e.message}${hint ? '\n  hint: ' + hint : ''}\n`);
    }
    return e.code === 'PLATFORM_ERROR' && /toolchain|找不到工具/.test(e.message) ? 3 : 1;
  }
  if (e instanceof Error) {
    if (globals.verbose) {
      process.stderr.write((e.stack ?? e.message) + '\n');
    } else {
      process.stderr.write('error: ' + e.message + '\n');
    }
    return 1;
  }
  process.stderr.write('error: ' + String(e) + '\n');
  return 1;
}

function friendlyHint(e: AdapterError): string {
  switch (e.code) {
    case 'AUTH_REQUIRED':
      return '请运行 `oja login <platform>` 登录';
    case 'RATE_LIMITED':
      return '请稍后再试,或调整 http.rateLimit / submission.minIntervalMs';
    case 'NETWORK_ERROR':
      return '检查网络或设置 http.proxy';
    case 'LANG_UNSUPPORTED':
      return '改用 --lang cpp|python3|java|javascript';
    case 'JUDGING_TIMEOUT':
      return '请增大 submission.pollTimeoutMs 或重试';
    default:
      return '';
  }
}
