/**
 * oja pull <ref> [--lang X --open --refresh]
 *
 * ref 可为:
 *   完整 URL(LeetCode CN / HDOJ)
 *   短形式 platform/id 或 platform/slug
 */
import { spawn } from 'node:child_process';
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';
import { promptConfirm } from '../utils/prompt.js';
import { ansiEnabled } from '../utils/globals.js';
import { colorize } from '../render/ansi.js';
import type { DefaultLang, PlatformId } from '@oj-agent/core';

const ALLOWED_LANGS: DefaultLang[] = ['cpp', 'python3', 'java', 'javascript'];

export const pullCommand: CommandModule = {
  name: 'pull',
  description: '拉取题目到本地工作区',
  flags: {
    lang: { type: 'string' },
    open: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
  },
  help() {
    return [
      'oja pull <ref> [options]',
      '',
      '<ref> 可为:',
      '  URL                     https://leetcode.cn/problems/two-sum/',
      '                          http://acm.hdu.edu.cn/showproblem.php?pid=1000',
      '                          https://codeforces.com/problemset/problem/1900/A',
      '                          https://www.luogu.com.cn/problem/P1001',
      '                          http://poj.org/problem?id=1000',
      '                          https://www.lanqiao.cn/problems/504/',
      '  短形式                  leetcode-cn/two-sum  |  hdoj/1000  |  codeforces/1900A',
      '                          luogu/P1001  |  poj/1000  |  lanqiao/504',
      '',
      'Options:',
      '  --lang cpp|python3|java|javascript   写入哪种 solution.* 模板',
      '  --open                  写盘后用系统打开题目目录',
      '  --refresh               若已存在则强制刷新(不询问)',
      '  --json                  机器可读输出',
    ].join('\n');
  },
  async run(ctx, args) {
    const ref = args.positional[0];
    if (!ref) throw new UsageError('缺少参数: <ref>');
    const lang = ((args.flags.lang as string | undefined) ??
      ctx.config.getWithDefault<string>('ui.defaultLang', 'cpp')) as DefaultLang;
    if (!ALLOWED_LANGS.includes(lang)) {
      throw new UsageError(`未知 --lang: ${lang}`);
    }
    const refresh = Boolean(args.flags.refresh);
    const openAfter = Boolean(args.flags.open);

    const parsed = parseRef(ref);
    if (!parsed) {
      throw new UsageError(`无法识别 ref: ${ref}`);
    }
    const { platform, id } = parsed;
    const adapter = ctx.registry.get(platform);
    const detail = await adapter.getProblem(id);

    const rootDir = ctx.config.getWithDefault<string>('workspace.root', '~/oj-agent-workspace');
    const problemDir = ctx.workspace.resolveProblemDir(
      detail.platform,
      detail.id,
      slugFromUrl(detail.url) ?? detail.title,
      rootDir,
    );

    // 若已存在询问 / 强制刷新
    let proceed = true;
    let isRefresh = false;
    try {
      const meta = await ctx.workspace.readMeta(problemDir);
      if (meta) {
        isRefresh = true;
        if (!refresh) {
          if (ctx.globals.quiet || ctx.globals.json || !process.stdin.isTTY) {
            proceed = false; // 默认 N
          } else {
            proceed = await promptConfirm('题目已在工作区,是否刷新?', false);
          }
        }
      }
    } catch {
      // 目录不存在 - 继续
    }

    if (!proceed) {
      if (!ctx.globals.json) {
        process.stderr.write('取消\n');
      }
      return 0;
    }

    let result: { problemDir: string; solutionPath: string };
    if (isRefresh && refresh) {
      await ctx.workspace.refresh(detail, problemDir);
      result = { problemDir, solutionPath: '' };
    } else {
      // 优先用 getProblemLangs 拿题目级语言能力（用于 codeSnippet 与 supportedLangs 对齐）
      let problemLangs;
      if (adapter.getProblemLangs) {
        try {
          problemLangs = await adapter.getProblemLangs(id);
        } catch {
          // 静默回退到 detail.codeSnippets / defaultTemplate
        }
      }
      const r = await ctx.workspace.writeProblem(detail, { rootDir, defaultLang: lang, problemLangs });
      result = { problemDir: r.problemDir, solutionPath: r.solutionPath };
    }

    if (ctx.globals.json) {
      process.stdout.write(
        JSON.stringify({
          problemDir: result.problemDir,
          solutionPath: result.solutionPath,
          platform,
          id: detail.id,
          title: detail.title,
        }) + '\n',
      );
    } else {
      const ansi = ansiEnabled(ctx.globals);
      process.stderr.write(
        colorize(ansi, 'green', '✓ ') + `${detail.platform}/${detail.id} ${detail.title}\n`,
      );
      process.stdout.write(result.problemDir + '\n');
    }

    if (openAfter) {
      openPath(result.problemDir).catch(() => undefined);
    }

    return 0;
  },
};

function parseRef(ref: string): { platform: PlatformId; id: string } | undefined {
  // LeetCode CN URL
  const lc = ref.match(/leetcode\.cn\/problems\/([^/?#]+)/);
  if (lc) return { platform: 'leetcode-cn', id: lc[1]! };
  // HDOJ URL
  const hd = ref.match(/acm\.hdu\.edu\.cn\/(?:showproblem\.php)?.*?pid=(\d+)/);
  if (hd) return { platform: 'hdoj', id: hd[1]! };
  // Codeforces URL：/problemset/problem/{cid}/{idx} 或 /contest/{cid}/problem/{idx}
  const cf = ref.match(/codeforces\.com\/(?:problemset\/problem|contest\/[^/]+\/problem)\/(\d+)\/([A-Z]\d?)/i);
  if (cf) return { platform: 'codeforces', id: `${cf[1]}${cf[2]!.toUpperCase()}` };
  // 洛谷 URL：/problem/{pid}
  const lg = ref.match(/luogu\.com\.cn\/problem\/([A-Za-z0-9]+)/);
  if (lg) return { platform: 'luogu', id: lg[1]! };
  // POJ URL：/problem?id=xxx
  const poj = ref.match(/poj\.org\/problem\?id=(\d+)/);
  if (poj) return { platform: 'poj', id: poj[1]! };
  // 蓝桥 URL：/problems/{id}/
  const lq = ref.match(/lanqiao\.cn\/problems\/(\d+)/);
  if (lq) return { platform: 'lanqiao', id: lq[1]! };
  // 短形式 platform/id
  const m = ref.match(/^(leetcode-cn|hdoj|codeforces|luogu|poj|lanqiao)\/(.+)$/);
  if (m) return { platform: m[1] as PlatformId, id: m[2]! };
  return undefined;
}

function slugFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/leetcode\.cn\/problems\/([^/?#]+)/);
  return m?.[1];
}

async function openPath(p: string): Promise<void> {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [p], { detached: true, stdio: 'ignore' }).unref();
}
