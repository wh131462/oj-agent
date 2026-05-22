/**
 * oja test [path] [--lang X --case 1,3-5 --timeout MS]
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CommandModule } from './types.js';
import { UsageError } from '../utils/args.js';
import { detectProblemDir } from '../utils/detect-problem-dir.js';
import { emitTAP } from '../render/tap.js';
import { AdapterError } from '@oj-agent/core';
import type { JudgeLang } from '@oj-agent/core';

const LANG_EXT: Record<JudgeLang, string> = {
  cpp: 'cpp',
  python3: 'py',
  java: 'java',
  javascript: 'js',
};

export const testCommand: CommandModule = {
  name: 'test',
  description: '本地测试当前题目',
  flags: {
    lang: { type: 'string' },
    case: { type: 'string' },
    timeout: { type: 'number' },
  },
  help() {
    return [
      'oja test [path] [options]',
      '',
      '不传 path 时从 CWD 向上推断 problemDir。',
      '',
      'Options:',
      '  --lang X            cpp / python3 / java / javascript',
      '  --case 1,3-5        仅运行指定编号(逗号分隔,范围用 -)',
      '  --timeout MS        每个用例 wallclock 超时(默认 3000 或配置项)',
      '  --json              输出 JSON,而非 TAP',
    ].join('\n');
  },
  async run(ctx, args) {
    const cwd = process.cwd();
    let problemDir: string;
    if (args.positional[0]) {
      problemDir = path.resolve(args.positional[0]);
    } else {
      const det = await detectProblemDir(cwd);
      if (!det) {
        throw new UsageError(
          '当前目录不在 oja 工作区内,请先 oja pull,或指定 problemDir 路径',
        );
      }
      problemDir = det.problemDir;
    }

    // 语言推断
    const lang = await resolveLang(ctx, problemDir, args.flags.lang as string | undefined);

    // 加载 cases(默认全量)+ 按 --case 筛选
    let cases = await loadCases(problemDir);
    const caseFilter = args.flags.case as string | undefined;
    if (caseFilter) {
      const allowed = parseCaseFilter(caseFilter);
      cases = cases.filter((c) => allowed.has(c.index));
    }

    const timeoutMs =
      (args.flags.timeout as number | undefined) ??
      ctx.config.getWithDefault<number>('judge.timeoutMs', 3000);

    // 自定义编译/运行模板(从 config 读取)
    const compileCmd = ctx.config.get<string>(`lang.${lang}.compile`);
    const runCmd = ctx.config.get<string>(`lang.${lang}.run`);

    const result = await ctx.judge.runAll({
      problemDir,
      lang,
      cases,
      timeoutMs,
      compileCmdTemplate: compileCmd,
      runCmdTemplate: runCmd,
    });

    if (result.compileError) {
      if (ctx.globals.json) {
        process.stdout.write(
          JSON.stringify({ problemDir, lang, cases: [], compileError: result.compileError }) + '\n',
        );
      } else {
        process.stderr.write('Compile Error:\n' + result.compileError + '\n');
      }
      return 1;
    }

    if (ctx.globals.json) {
      process.stdout.write(JSON.stringify({ problemDir, lang, cases: result.cases }) + '\n');
    } else {
      emitTAP(result.cases);
    }

    const allAc = result.cases.every((c) => c.verdict === 'AC');
    return allAc ? 0 : 1;
  },
};

async function resolveLang(
  ctx: import('../context.js').CliContext,
  problemDir: string,
  override?: string,
): Promise<JudgeLang> {
  if (override) {
    if (!(override in LANG_EXT)) throw new UsageError(`未知 --lang: ${override}`);
    return override as JudgeLang;
  }
  // 扫描 solution.* / Main.java
  const files = await fs.readdir(problemDir).catch(() => [] as string[]);
  const candidates: JudgeLang[] = [];
  for (const f of files) {
    if (f === 'Main.java') candidates.push('java');
    if (f === 'solution.cpp') candidates.push('cpp');
    if (f === 'solution.py') candidates.push('python3');
    if (f === 'solution.js') candidates.push('javascript');
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) {
    const def = ctx.config.getWithDefault<string>('ui.defaultLang', 'cpp');
    if (candidates.includes(def as JudgeLang)) return def as JudgeLang;
    throw new UsageError(
      `检测到多种 solution 文件(${candidates.join(', ')}),请用 --lang 显式指定`,
    );
  }
  throw new UsageError(`未找到 solution 文件,请先运行 oja pull 或手动创建`);
}

async function loadCases(problemDir: string) {
  const casesDir = path.join(problemDir, 'cases');
  const files = await fs.readdir(casesDir).catch(() => [] as string[]);
  const indexes = new Set<number>();
  for (const f of files) {
    const m = f.match(/^in_(\d+)\.txt$/);
    if (m) indexes.add(Number(m[1]));
  }
  const sorted = [...indexes].sort((a, b) => a - b);
  const cases = [];
  for (const n of sorted) {
    const input = await fs.readFile(path.join(casesDir, `in_${n}.txt`), 'utf-8').catch(() => '');
    let expected: string | undefined;
    try {
      expected = await fs.readFile(path.join(casesDir, `out_${n}.txt`), 'utf-8');
    } catch {
      expected = undefined;
    }
    cases.push({ index: n, input, expected });
  }
  return cases;
}

function parseCaseFilter(s: string): Set<number> {
  const set = new Set<number>();
  for (const part of s.split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let i = a; i <= b; i++) set.add(i);
    } else if (/^\d+$/.test(part)) {
      set.add(Number(part));
    }
  }
  return set;
}
