/**
 * 本地判题执行器。
 *
 * 流程:
 *   1. 工具链探测(缺失抛 PLATFORM_ERROR)
 *   2. 编译(命中缓存则跳过);失败返回 { cases: [], compileError }
 *   3. 逐 case 执行子进程,stdin 喂样例,捕获 stdout/stderr,wallclock 超时
 *   4. 输出归一化 + diff + verdict
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AdapterError } from '../platform/errors.js';
import { NoopLogger, type LoggerBackend } from '../logger/logger.js';
import { ToolchainProbe, type ToolchainSnapshot } from './toolchain.js';
import { renderTemplate } from './template.js';
import { firstDiff, normalize, unifiedDiff } from './normalize.js';
import { buildDirExists, computeBuildHash, ensureBuildDir, getBuildDir } from './cache.js';

export type JudgeLang = 'cpp' | 'c' | 'python3' | 'java' | 'javascript';
export type JudgeVerdict = 'AC' | 'WA' | 'TLE' | 'RE' | 'CE';

export interface JudgeCaseInput {
  index: number;
  input: string;
  expected?: string;
}

export interface JudgeCaseResult {
  index: number;
  verdict: JudgeVerdict;
  timeMs: number;
  input: string;
  stdout: string;
  stderr: string;
  expected?: string;
  diff?: {
    firstDiffLine: number;
    firstDiffCol: number;
    unifiedDiff: string;
  };
}

export interface JudgeRunOptions {
  problemDir: string;
  lang: JudgeLang;
  sourcePath?: string;
  cases?: JudgeCaseInput[];
  timeoutMs?: number;
  compileCmdTemplate?: string;
  runCmdTemplate?: string;
}

export interface JudgeRunResult {
  cases: JudgeCaseResult[];
  compileError?: string;
}

interface LangDefaults {
  compileCmd: string | null;
  runCmd: string;
  requiredTools: Array<keyof ToolchainSnapshot>;
}

const LANG_DEFAULTS: Record<JudgeLang, LangDefaults> = {
  cpp: {
    compileCmd: 'g++ -O2 -std=c++17 -o {out} {src}',
    runCmd: '{out}',
    requiredTools: ['gpp'],
  },
  c: {
    compileCmd: 'gcc -O2 -std=c11 -o {out} {src}',
    runCmd: '{out}',
    requiredTools: ['gcc'],
  },
  python3: {
    compileCmd: null,
    runCmd: 'python3 {src}',
    requiredTools: ['python3'],
  },
  java: {
    compileCmd: 'javac -d {dir} {src}',
    runCmd: 'java -cp {dir} {main}',
    requiredTools: ['javac', 'java'],
  },
  javascript: {
    compileCmd: null,
    runCmd: 'node {src}',
    requiredTools: ['node'],
  },
};

const LANG_EXT: Record<JudgeLang, string> = {
  cpp: 'cpp',
  c: 'c',
  python3: 'py',
  java: 'java',
  javascript: 'js',
};

const INSTALL_HINTS: Record<keyof ToolchainSnapshot, string> = {
  gpp: '请安装 g++(macOS: xcode-select --install; Ubuntu: apt install g++)',
  gcc: '请安装 gcc(macOS: xcode-select --install; Ubuntu: apt install gcc)',
  clangpp: '请安装 clang++',
  python3: '请安装 Python 3 (https://www.python.org/downloads/)',
  python: '请安装 Python',
  javac: '请安装 JDK(https://adoptium.net/)',
  java: '请安装 JDK 运行时',
  node: '请安装 Node.js (https://nodejs.org/)',
};

export class JudgeRunner {
  private readonly logger: LoggerBackend;
  private readonly toolchain: ToolchainProbe;

  constructor(opts: { logger?: LoggerBackend; toolchain?: ToolchainProbe } = {}) {
    this.logger = opts.logger ?? new NoopLogger();
    this.toolchain = opts.toolchain ?? new ToolchainProbe({ logger: this.logger });
  }

  async runAll(options: JudgeRunOptions): Promise<JudgeRunResult> {
    const { problemDir, lang } = options;
    const defaults = LANG_DEFAULTS[lang];
    // 函数题:同目录存在 harness.<ext> 时,改编 harness。solution.<ext> 仍为用户编辑文件,
    // C++ 通过 #include "solution.cpp" 把它拉进翻译单元;
    // Java 是双文件同时 javac;
    // Python/JS 通过运行时 import / vm 加载。
    const harnessName = lang === 'java' ? 'Harness.java' : `harness.${LANG_EXT[lang]}`;
    const harnessPath = path.join(problemDir, harnessName);
    const harnessExists = await fs.stat(harnessPath).then(() => true).catch(() => false);
    const sourcePath =
      options.sourcePath ??
      (harnessExists
        ? harnessPath
        : lang === 'java'
        ? path.join(problemDir, 'Main.java')
        : path.join(problemDir, `solution.${LANG_EXT[lang]}`));

    // 工具链探测
    const snapshot = await this.toolchain.probe();
    for (const t of defaults.requiredTools) {
      if (!snapshot[t]) {
        throw new AdapterError(
          'PLATFORM_ERROR',
          `找不到工具 ${t}:${INSTALL_HINTS[t]}`,
          false,
        );
      }
    }

    // 加载 cases
    const cases = options.cases ?? (await this.loadCasesFromMeta(problemDir));
    const timeoutMs = options.timeoutMs ?? 3000;

    // 编译
    let srcContent = '';
    try {
      srcContent = await fs.readFile(sourcePath, 'utf-8');
    } catch (e) {
      throw new AdapterError('PLATFORM_ERROR', `读取源文件失败: ${sourcePath}`, false, e);
    }

    // 走 harness 模式时,solution.<ext> 通过 #include 注入,缓存命中必须把它也算进去。
    let hashSrc = srcContent;
    if (harnessExists) {
      const solName = lang === 'java' ? 'Main.java' : `solution.${LANG_EXT[lang]}`;
      const solPath = path.join(problemDir, solName);
      const solContent = await fs.readFile(solPath, 'utf-8').catch(() => '');
      hashSrc = srcContent + '\n///__OJA_SOLUTION__///\n' + solContent;
    }

    const compileCmdTpl = options.compileCmdTemplate ?? defaults.compileCmd;
    let buildDir = '';
    let runArtifact = sourcePath; // python/js 默认直接跑 src
    // Java 主类名:harness 模式跑 Harness,否则跑 Main
    const javaMainClass = lang === 'java' ? (harnessExists ? 'Harness' : 'Main') : 'Main';
    if (compileCmdTpl) {
      const hash = computeBuildHash(hashSrc, compileCmdTpl);
      buildDir = getBuildDir(problemDir, hash);
      const cached = await buildDirExists(buildDir);
      if (!cached) {
        await ensureBuildDir(buildDir);
        const out = lang === 'java' ? buildDir : path.join(buildDir, baseName(sourcePath, lang));
        const cmd = renderTemplate(compileCmdTpl, {
          src: sourcePath,
          out,
          dir: buildDir,
          main: javaMainClass,
        });
        const compileRes = await runShell(cmd, { stdin: '', timeoutMs: 30_000, cwd: problemDir });
        if (compileRes.exitCode !== 0) {
          this.logger.warn('judge', 'compile failed', { lang, stderr: compileRes.stderr });
          // 清空 build dir,避免下次误命中
          await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {});
          return { cases: [], compileError: compileRes.stderr || compileRes.stdout || '编译失败' };
        }
        runArtifact = out;
      } else {
        runArtifact =
          lang === 'java' ? buildDir : path.join(buildDir, baseName(sourcePath, lang));
      }
    }

    // 渲染 run 命令模板
    const runCmdTpl = options.runCmdTemplate ?? defaults.runCmd;
    const runCmd = renderTemplate(runCmdTpl, {
      src: sourcePath,
      out: runArtifact,
      dir: buildDir || problemDir,
      main: javaMainClass,
    });

    // 逐 case 执行
    const caseResults: JudgeCaseResult[] = [];
    for (const c of cases) {
      const res = await runShell(runCmd, {
        stdin: c.input,
        timeoutMs,
        cwd: problemDir,
      });
      const stdout = res.stdout;
      const stderr = res.stderr;
      const timeMs = res.timeMs;
      let verdict: JudgeVerdict;
      let diff: JudgeCaseResult['diff'];
      if (res.timedOut) {
        verdict = 'TLE';
      } else if (res.exitCode !== 0) {
        verdict = 'RE';
      } else if (c.expected === undefined) {
        // 无期望输出时,统一记作 AC(仅捕获输出)
        verdict = 'AC';
      } else {
        const expectedNorm = normalize(c.expected);
        const actualNorm = normalize(stdout);
        if (expectedNorm === actualNorm) {
          verdict = 'AC';
        } else {
          verdict = 'WA';
          const fd = firstDiff(stdout, c.expected)!;
          diff = {
            firstDiffLine: fd.line,
            firstDiffCol: fd.col,
            unifiedDiff: unifiedDiff(stdout, c.expected, 100),
          };
        }
      }
      caseResults.push({
        index: c.index,
        verdict,
        timeMs,
        input: c.input,
        stdout,
        stderr,
        expected: c.expected,
        diff,
      });
    }

    return { cases: caseResults };
  }

  private async loadCasesFromMeta(problemDir: string): Promise<JudgeCaseInput[]> {
    const casesDir = path.join(problemDir, 'cases');
    const files = await fs.readdir(casesDir).catch(() => [] as string[]);
    const indexes = new Set<number>();
    for (const f of files) {
      const m = f.match(/^in_(\d+)\.txt$/);
      if (m) indexes.add(Number(m[1]));
    }
    const sorted = [...indexes].sort((a, b) => a - b);
    const cases: JudgeCaseInput[] = [];
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
}

function baseName(srcPath: string, lang: JudgeLang): string {
  const base = path.basename(srcPath).replace(new RegExp(`\\.${LANG_EXT[lang]}$`), '');
  if (process.platform === 'win32' && lang === 'cpp') return base + '.exe';
  return base;
}

interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timeMs: number;
  timedOut: boolean;
}

function runShell(
  cmd: string,
  opts: { stdin: string; timeoutMs: number; cwd?: string },
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const shell = process.platform === 'win32' ? 'cmd' : 'sh';
    const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
    const child = spawn(shell, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {}
    }, opts.timeoutMs);

    child.once('error', () => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr,
        timeMs: Date.now() - start,
        timedOut,
      });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        timeMs: Date.now() - start,
        timedOut,
      });
    });

    // 写 stdin
    try {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    } catch {
      // 子进程已死,忽略
    }
  });
}
