/**
 * oja login <platform> [--manual] [--cookie <raw>] [--browser <name>] [--browser-timeout-ms <n>]
 *
 * 默认使用浏览器自动登录(playwright-core 复用系统 Chrome/Edge/Brave/Chromium)。
 * 失败 / 不可用 / --manual / --cookie 时降级到 M1 粘贴流程。
 */

import type { CommandModule } from './types.js';
import { promptText } from '../utils/prompt.js';
import { UsageError } from '../utils/args.js';
import {
  LoginFlow,
  platformLoginConfigs,
  type LoginConfig,
  type LoginResult,
  type PlatformId,
} from '@oj-agent/core';
import { PlaywrightBrowserLogin } from '../backends/playwright-browser-login.js';
import { colorize } from '../render/ansi.js';
import { ansiEnabled } from '../utils/globals.js';
import type { CliContext } from '../context.js';

export const loginCommand: CommandModule = {
  name: 'login',
  description: '登录到指定 OJ 平台',
  flags: {
    cookie: { type: 'string', description: '直接传入整段 cookie,跳过交互与浏览器' },
    manual: { type: 'boolean', default: false, description: '跳过浏览器,走粘贴流程' },
    browser: { type: 'string', description: '优先尝试的浏览器: chrome / msedge / brave / chromium' },
    'browser-timeout-ms': { type: 'number', description: '浏览器登录总超时,默认 300000' },
  },
  help() {
    return [
      'oja login <platform> [options]',
      '',
      'Platforms:',
      '  leetcode-cn   默认浏览器自动登录;失败降级到粘贴 SESSION + csrftoken',
      '  hdoj          交互输入账号密码 form POST 登录',
      '',
      'Options:',
      '  --cookie <raw>             直接传整段 cookie,跳过交互与浏览器',
      '  --manual                   跳过浏览器,走 M1 粘贴流程',
      '  --browser <name>           chrome / msedge / brave / chromium 优先尝试',
      '  --browser-timeout-ms <n>   浏览器登录总超时(ms),默认 300000',
    ].join('\n');
  },
  async run(ctx, args) {
    const platform = args.positional[0] as PlatformId | undefined;
    if (!platform) throw new UsageError('缺少参数: <platform>');
    if (platform !== 'leetcode-cn' && platform !== 'hdoj') {
      throw new UsageError(`未知平台: ${platform}(仅支持 leetcode-cn / hdoj)`);
    }

    const rawCookie = typeof args.flags.cookie === 'string' ? args.flags.cookie : undefined;
    const manual = Boolean(args.flags.manual);
    const preferredBrowser = args.flags.browser as string | undefined;
    const browserTimeout = args.flags['browser-timeout-ms'] as number | undefined;

    // --cookie 走"直接写入"路径(不进浏览器,也不进粘贴)
    if (rawCookie) {
      return runCookieDirect(ctx, platform, rawCookie);
    }

    // --manual 显式跳过浏览器
    if (manual) {
      return runManual(ctx, platform);
    }

    // 默认:尝试浏览器自动登录,失败降级到 manual
    const config = platformLoginConfigs[platform];
    if (!config) {
      // 平台无 LoginConfig,直接走 manual
      return runManual(ctx, platform);
    }
    const browserResult = await runBrowser(ctx, config, preferredBrowser, browserTimeout);
    if (browserResult === 'fallback') {
      return runManual(ctx, platform);
    }
    return browserResult;
  },
};

/** --cookie 路径:直接写入 + 校验。 */
async function runCookieDirect(
  ctx: CliContext,
  platform: PlatformId,
  rawCookie: string,
): Promise<number> {
  const ansi = ansiEnabled(ctx.globals);
  await ctx.credentialStore.set(platform, { platform, cookie: rawCookie });
  const status = await ctx.credChecker.check(platform);
  if (status !== 'valid') {
    await ctx.credentialStore.delete(platform);
    if (!ctx.globals.json) {
      process.stderr.write(colorize(ansi, 'red', `登录失败: ${status}\n`));
    }
    return 1;
  }
  if (ctx.globals.json) {
    process.stdout.write(JSON.stringify({ ok: true, platform, mode: 'cookie' }) + '\n');
  } else {
    process.stderr.write(colorize(ansi, 'green', `✓ ${platform} 登录成功(--cookie)\n`));
  }
  return 0;
}

/**
 * 浏览器路径。返回:
 *   0 / 1 = 命令最终退出码;
 *   'fallback' = 浏览器不可用 / 平台不支持,需要降级到 manual。
 */
async function runBrowser(
  ctx: CliContext,
  config: LoginConfig,
  preferredBrowser: string | undefined,
  timeoutMs: number | undefined,
): Promise<number | 'fallback'> {
  const ansi = ansiEnabled(ctx.globals);
  const capture = new PlaywrightBrowserLogin({
    preferredBrowser: preferredBrowser as 'chrome' | 'msedge' | 'brave' | 'chromium' | undefined,
    onLaunched(info) {
      if (ctx.globals.json || ctx.globals.quiet) return;
      process.stderr.write(`[oja] 已启动浏览器: ${info.name}\n`);
      process.stderr.write(`[oja] 已打开 ${config.loginUrl},请在浏览器内完成登录(支持账号密码 / 微信扫码 / 第三方)\n`);
      process.stderr.write(`[oja] 等待登录完成...(按 Ctrl+C 取消并切换到粘贴模式)\n`);
    },
  });
  const flow = new LoginFlow({
    capture,
    credentialStore: ctx.credentialStore,
    credChecker: ctx.credChecker,
    logger: ctx.logger,
  });

  // SIGINT 处理:优雅取消浏览器
  let cancelled = false;
  const onSigint = () => {
    cancelled = true;
    void flow.cancel();
  };
  process.on('SIGINT', onSigint);

  try {
    const cfg: LoginConfig = timeoutMs ? { ...config, timeoutMs } : config;
    const result: LoginResult = await flow.run(cfg);
    process.off('SIGINT', onSigint);

    if (result.ok) {
      if (ctx.globals.json) {
        process.stdout.write(
          JSON.stringify({ ok: true, platform: config.platform, mode: 'browser', username: result.username }) + '\n',
        );
      } else {
        const userPart = result.username ? `(用户名: ${result.username})` : '';
        process.stderr.write(colorize(ansi, 'green', `✓ ${config.platform} 登录成功${userPart}\n`));
      }
      return 0;
    }

    // 失败处理
    switch (result.reason) {
      case 'browser-not-found':
        if (!ctx.globals.json) {
          process.stderr.write(
            `[oja] 自动登录不可用(${result.message}),改用粘贴模式...\n`,
          );
        }
        return 'fallback';
      case 'cancelled':
        if (cancelled) {
          process.stderr.write(`[oja] 已取消,可使用 \`oja login --manual\` 走粘贴模式\n`);
          return 130;
        }
        if (!ctx.globals.json) {
          process.stderr.write(`[oja] 浏览器已被取消\n`);
        }
        return 1;
      case 'timeout':
        if (!ctx.globals.json) {
          process.stderr.write(colorize(ansi, 'red', `登录失败: ${result.message}(可改用 --manual 粘贴 cookie)\n`));
        }
        return 1;
      case 'auth-invalid':
        if (!ctx.globals.json) {
          process.stderr.write(colorize(ansi, 'red', `登录失败: ${result.message}\n`));
        }
        return 1;
      case 'capture-failed':
      default:
        if (!ctx.globals.json) {
          process.stderr.write(colorize(ansi, 'red', `登录失败: ${result.message}\n`));
        }
        return 1;
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
}

/** M1 粘贴流程(LeetCode CN 两步 / HDOJ 账号密码)。 */
async function runManual(ctx: CliContext, platform: PlatformId): Promise<number> {
  const ansi = ansiEnabled(ctx.globals);
  if (platform === 'leetcode-cn') {
    const session = await promptText('LEETCODE_SESSION: ', { hidden: true });
    const csrf = await promptText('csrftoken: ');
    if (!session || !csrf) {
      if (!ctx.globals.json) process.stderr.write('SESSION 与 csrftoken 不能为空\n');
      return 3;
    }
    const cookie = `LEETCODE_SESSION=${session}; csrftoken=${csrf}`;
    await ctx.credentialStore.set('leetcode-cn', { platform: 'leetcode-cn', cookie });
    const status = await ctx.credChecker.check('leetcode-cn');
    if (status !== 'valid') {
      await ctx.credentialStore.delete('leetcode-cn');
      if (!ctx.globals.json) {
        process.stderr.write(colorize(ansi, 'red', `登录失败: ${status}\n`));
      }
      return 1;
    }
    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify({ ok: true, platform, mode: 'manual' }) + '\n');
    } else {
      process.stderr.write(colorize(ansi, 'green', '✓ LeetCode CN 登录成功(粘贴模式)\n'));
    }
    return 0;
  }

  // HDOJ 粘贴 / 账号密码
  const username = await promptText('HDOJ 用户名: ');
  const password = await promptText('HDOJ 密码: ', { hidden: true });
  if (!username || !password) {
    if (!ctx.globals.json) process.stderr.write('用户名 / 密码不能为空\n');
    return 3;
  }
  const res = await ctx.httpClient.request({
    url: 'http://acm.hdu.edu.cn/userloginex.php',
    method: 'POST',
    query: { action: 'login' },
    contentType: 'form',
    formEncoding: 'gbk',
    responseEncoding: 'gbk',
    body: { username, userpass: password, login: 'Sign In' },
    headers: { Referer: 'http://acm.hdu.edu.cn/userloginex.php' },
    rateLimitKey: 'hdoj',
    timeoutMs: 15_000,
  });
  const setCookie = res.headers['set-cookie'];
  const m = setCookie?.match(/PHPSESSID=([^;]+)/);
  if (!m) {
    if (!ctx.globals.json) process.stderr.write(colorize(ansi, 'red', '登录失败: 未收到 PHPSESSID\n'));
    return 1;
  }
  await ctx.credentialStore.set('hdoj', {
    platform: 'hdoj',
    cookie: `PHPSESSID=${m[1]}`,
    extra: { username },
  });
  const status = await ctx.credChecker.check('hdoj');
  if (status === 'expired') {
    await ctx.credentialStore.delete('hdoj');
    if (!ctx.globals.json) {
      process.stderr.write(colorize(ansi, 'red', '登录失败:cookie 校验未通过(账号密码错?)\n'));
    }
    return 1;
  }
  if (ctx.globals.json) {
    process.stdout.write(JSON.stringify({ ok: true, platform, mode: 'manual', username }) + '\n');
  } else {
    process.stderr.write(colorize(ansi, 'green', `✓ HDOJ 登录成功(${username})\n`));
  }
  return 0;
}
