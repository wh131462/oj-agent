/**
 * oja submit [path] [--lang X --no-confirm]
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';
import { detectProblemDir } from '../utils/detect-problem-dir.js';
import { promptConfirm } from '../utils/prompt.js';
import { ProgressLine } from '../render/progress.js';
import { ansiEnabled } from '../utils/globals.js';
import { colorize } from '../render/ansi.js';
import type { JudgeLang } from '@oj-agent/core';

const LANG_FILENAME: Record<JudgeLang, string> = {
  cpp: 'solution.cpp',
  python3: 'solution.py',
  java: 'Main.java',
  javascript: 'solution.js',
};

export const submitCommand: CommandModule = {
  name: 'submit',
  description: '提交当前题目代码',
  flags: {
    lang: { type: 'string' },
    'no-confirm': { type: 'boolean', default: false },
  },
  help() {
    return [
      'oja submit [path] [options]',
      '',
      'Options:',
      '  --lang X            cpp / python3 / java / javascript',
      '  --no-confirm        跳过提交前确认',
      '  --json              机器可读输出',
    ].join('\n');
  },
  async run(ctx, args) {
    const cwd = process.cwd();
    let problemDir: string;
    let platform: 'leetcode-cn' | 'hdoj';
    let problemId: string;

    if (args.positional[0]) {
      problemDir = path.resolve(args.positional[0]);
      // 从路径回溯 platform/id
      const det = await detectProblemDir(problemDir);
      if (!det) throw new UsageError('指定 path 不在合法 oja 工作区结构');
      platform = det.platform as 'leetcode-cn' | 'hdoj';
      problemId = det.id;
    } else {
      const det = await detectProblemDir(cwd);
      if (!det) {
        throw new UsageError('当前目录不在 oja 工作区内,请先 oja pull,或指定 problemDir 路径');
      }
      problemDir = det.problemDir;
      platform = det.platform as 'leetcode-cn' | 'hdoj';
      problemId = det.id;
    }

    // meta.json 取 slug(LeetCode 提交需 slug)
    const meta = await ctx.workspace.readMeta(problemDir);
    const submitId = platform === 'leetcode-cn' ? (meta?.slug ?? problemId) : problemId;

    const lang = await resolveLang(ctx, problemDir, args.flags.lang as string | undefined);
    const filename = LANG_FILENAME[lang];
    const codePath = path.join(problemDir, filename);
    const code = await fs.readFile(codePath, 'utf-8').catch(() => '');
    if (!code) throw new UsageError(`读不到代码:${codePath}`);

    // 确认
    if (!args.flags['no-confirm'] && !ctx.globals.json && process.stdin.isTTY) {
      const ok = await promptConfirm(
        `确认提交到 ${platform} 题号 ${problemId}(lang=${lang})?`,
        true,
      );
      if (!ok) {
        process.stderr.write('取消\n');
        return 0;
      }
    }

    const ansi = ansiEnabled(ctx.globals);
    const progress = new ProgressLine(ctx.globals);

    const minIntervalMs = ctx.config.getWithDefault<number>('submission.minIntervalMs', 5000);
    const pollTimeoutMs = ctx.config.getWithDefault<number>('submission.pollTimeoutMs', 60_000);

    try {
      const result = await ctx.submission.run({
        platform,
        problemId: submitId,
        lang,
        code,
        minIntervalMs,
        pollTimeoutMs,
        onProgress: (state) => {
          if (state.stage === 'pre-check') progress.update('checking…');
          else if (state.stage === 'submitting') progress.update(colorize(ansi, 'cyan', '↑ submitting…'));
          else if (state.stage === 'judging') progress.update(colorize(ansi, 'cyan', '⌛ judging…'));
          else if (state.stage === 'done') progress.done(formatDone(state.result.verdict, state.result.timeMs, state.result.memoryKb, ansi));
        },
      });

      if (ctx.globals.json) {
        process.stdout.write(JSON.stringify({ stage: 'done', ...result }) + '\n');
      }

      return result.verdict === 'AC' ? 0 : 1;
    } catch (e) {
      progress.fail('failed');
      throw e;
    }
  },
};

async function resolveLang(
  ctx: import('../context.js').CliContext,
  problemDir: string,
  override?: string,
): Promise<JudgeLang> {
  if (override) {
    if (!(override in LANG_FILENAME)) throw new UsageError(`未知 --lang: ${override}`);
    return override as JudgeLang;
  }
  const files = await fs.readdir(problemDir).catch(() => [] as string[]);
  const cands: JudgeLang[] = [];
  for (const f of files) {
    for (const [k, v] of Object.entries(LANG_FILENAME)) {
      if (f === v) cands.push(k as JudgeLang);
    }
  }
  if (cands.length === 1) return cands[0]!;
  if (cands.length > 1) {
    const def = ctx.config.getWithDefault<string>('ui.defaultLang', 'cpp');
    if (cands.includes(def as JudgeLang)) return def as JudgeLang;
    throw new UsageError(`多种 solution 文件(${cands.join(', ')}),请用 --lang 指定`);
  }
  throw new UsageError('未找到 solution 文件');
}

function formatDone(verdict: string, timeMs?: number, memoryKb?: number, ansi = false): string {
  const color =
    verdict === 'AC'
      ? 'green'
      : verdict === 'WA' || verdict === 'RE' || verdict === 'CE' || verdict === 'MLE' || verdict === 'TLE'
        ? 'red'
        : 'yellow';
  const time = timeMs !== undefined ? ` ${timeMs}ms` : '';
  const mem = memoryKb !== undefined ? ` ${memoryKb}KB` : '';
  return colorize(ansi, color as 'green' | 'red' | 'yellow', `${verdict}${time}${mem}`);
}
