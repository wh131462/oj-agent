/**
 * oja login <platform> [--cookie <raw>]
 *
 * leetcode-cn:交互式收集 LEETCODE_SESSION + csrftoken,或 --cookie 整段
 * hdoj:交互式账密 + form POST 登录,或 --cookie 整段(含 PHPSESSID)
 */

import type { CommandModule } from './types.js';
import { promptText } from '../utils/prompt.js';
import { UsageError } from '../utils/args.js';
import { AdapterError } from '@oj-agent/core';
import { colorize } from '../render/ansi.js';
import { ansiEnabled } from '../utils/globals.js';

export const loginCommand: CommandModule = {
  name: 'login',
  description: '登录到指定 OJ 平台',
  flags: {
    cookie: { type: 'string', description: '直接传入整段 cookie,跳过交互' },
  },
  help() {
    return [
      'oja login <platform> [--cookie <raw>]',
      '',
      'Platforms:',
      '  leetcode-cn   交互输入 LEETCODE_SESSION + csrftoken',
      '  hdoj          交互输入账号密码',
      '',
      'Options:',
      '  --cookie <raw>   直接传整段 cookie,跳过交互',
    ].join('\n');
  },
  async run(ctx, args) {
    const platform = args.positional[0];
    if (!platform) throw new UsageError('缺少参数: <platform>');
    if (platform !== 'leetcode-cn' && platform !== 'hdoj') {
      throw new UsageError(`未知平台: ${platform}(仅支持 leetcode-cn / hdoj)`);
    }
    const rawCookie = typeof args.flags.cookie === 'string' ? args.flags.cookie : undefined;
    const ansi = ansiEnabled(ctx.globals);

    if (platform === 'leetcode-cn') {
      let cookie: string;
      if (rawCookie) {
        cookie = rawCookie;
      } else {
        const session = await promptText('LEETCODE_SESSION: ', { hidden: true });
        const csrf = await promptText('csrftoken: ');
        if (!session || !csrf) throw new UsageError('SESSION 与 csrftoken 不能为空');
        cookie = `LEETCODE_SESSION=${session}; csrftoken=${csrf}`;
      }
      // 先临时写入用以校验
      await ctx.credentialStore.set('leetcode-cn', { platform: 'leetcode-cn', cookie });
      const status = await ctx.credChecker.check('leetcode-cn');
      if (status !== 'valid') {
        // 失败回滚
        await ctx.credentialStore.delete('leetcode-cn');
        if (!ctx.globals.json) {
          process.stderr.write(colorize(ansi, 'red', `登录失败: ${status}\n`));
        }
        return 1;
      }
      if (ctx.globals.json) {
        process.stdout.write(JSON.stringify({ ok: true, platform }) + '\n');
      } else {
        process.stderr.write(colorize(ansi, 'green', '✓ LeetCode CN 登录成功\n'));
      }
      return 0;
    }

    // hdoj
    let cookie: string;
    let username: string | undefined;
    if (rawCookie) {
      cookie = rawCookie;
      // 尝试从 cookie 中解析 username(若无,留空,后续依赖用户调 status 时探活)
    } else {
      username = await promptText('HDOJ 用户名: ');
      const password = await promptText('HDOJ 密码: ', { hidden: true });
      if (!username || !password) throw new UsageError('用户名 / 密码不能为空');
      // 直接通过 HttpClient 调登录端点
      const res = await ctx.httpClient.request({
        url: 'http://acm.hdu.edu.cn/userloginex.php',
        method: 'POST',
        query: { action: 'login' },
        contentType: 'form',
        formEncoding: 'gbk',
        responseEncoding: 'gbk',
        body: {
          username,
          userpass: password,
          login: 'Sign In',
        },
        headers: {
          Referer: 'http://acm.hdu.edu.cn/userloginex.php',
        },
        rateLimitKey: 'hdoj',
        timeoutMs: 15000,
      });
      // 提取 Set-Cookie PHPSESSID
      const setCookie = res.headers['set-cookie'];
      const m = setCookie?.match(/PHPSESSID=([^;]+)/);
      if (!m) {
        if (!ctx.globals.json) {
          process.stderr.write(colorize(ansi, 'red', '登录失败: 未收到 PHPSESSID\n'));
        }
        return 1;
      }
      cookie = `PHPSESSID=${m[1]}`;
    }
    await ctx.credentialStore.set('hdoj', {
      platform: 'hdoj',
      cookie,
      extra: username ? { username } : undefined,
    });
    // 校验
    const status = await ctx.credChecker.check('hdoj');
    if (status === 'expired') {
      await ctx.credentialStore.delete('hdoj');
      if (!ctx.globals.json) {
        process.stderr.write(colorize(ansi, 'red', '登录失败:cookie 校验未通过(账号密码错?)\n'));
      }
      return 1;
    }
    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify({ ok: true, platform, username }) + '\n');
    } else {
      process.stderr.write(colorize(ansi, 'green', `✓ HDOJ 登录成功(${username ?? 'cookie 已写入'})\n`));
    }
    return 0;
  },
};
