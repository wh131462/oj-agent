/**
 * 工作区管理器。
 *
 * 落盘约定:
 *   <rootDir>/<platform>/<id>-<slug>/
 *     problem.md
 *     meta.json
 *     cases/in_<n>.txt
 *     cases/out_<n>.txt
 *     solution.<ext>   (已存在不覆盖)
 *
 * 所有写入使用 LF 换行、UTF-8 无 BOM。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  PlatformId,
  PlatformProblemDetail,
  ProblemLangInfo,
} from '../platform/adapter.js';
import type { HarnessSpec } from '../judge/harness/spec.js';
import { generateCppHarness } from '../judge/harness/cpp.js';
import { generatePythonHarness } from '../judge/harness/python.js';
import { generateJsHarness } from '../judge/harness/javascript.js';
import { generateJavaHarness } from '../judge/harness/java.js';
import { NoopLogger, type LoggerBackend } from '../logger/logger.js';
import { normalizeSlug } from './slug.js';

export type DefaultLang = 'cpp' | 'c' | 'python3' | 'java' | 'javascript';

export const LANG_EXT: Record<DefaultLang, string> = {
  cpp: 'cpp',
  c: 'c',
  python3: 'py',
  java: 'java',
  javascript: 'js',
};

export interface WorkspaceMeta {
  platform: PlatformId;
  id: string;
  title: string;
  slug: string;
  url?: string;
  difficulty?: string;
  tags?: string[];
  samples: Array<{ input: string; output: string }>;
  timeLimitMs?: number;
  memoryLimitKb?: number;
  codeSnippets?: Record<string, string>;
  fetchedAt: string;
  updatedAt: string;
  statementHash: string;
  /** 本地新增的自定义用例编号（cases/in_<n>.txt 的 n），用于在 UI 上区分远端 sample 与用户用例。旧 meta 缺省视为空数组。 */
  customCaseIndices?: number[];
  /**
   * 函数题 harness 规范（leetcode 等）。
   * - kind=function:judge runner 会编译 harness.<ext> 而非 solution.<ext>
   * - kind=unsupported:本地判题会失败,UI 应提示"请走云端"
   * - undefined:此题不是函数题模式
   */
  harnessSpec?: HarnessSpec;
}

export interface WriteProblemOptions {
  rootDir: string;
  defaultLang?: DefaultLang;
  /** 远端 updatedAt(ISO 字符串),不传则使用当前时间。 */
  remoteUpdatedAt?: string;
  /**
   * 该题语言能力（来自 adapter.getProblemLangs?()）。
   *
   * 提供时：写 solution.* 优先使用此处对应 lang 的 codeSnippet。
   * 不提供时：回退到 detail.codeSnippets（按 langSlug 取），再回退到内置 defaultTemplate。
   */
  problemLangs?: readonly ProblemLangInfo[];
}

export interface WriteProblemResult {
  problemDir: string;
  created: boolean;
  solutionPath: string;
}

export class WorkspaceManager {
  private readonly logger: LoggerBackend;

  constructor(opts: { logger?: LoggerBackend } = {}) {
    this.logger = opts.logger ?? new NoopLogger();
  }

  resolveProblemDir(
    platform: PlatformId,
    id: string,
    rawSlug: string,
    rootDir: string,
  ): string {
    const slug = normalizeSlug(rawSlug, id);
    const name = slug ? `${id}-${slug}` : id;
    return path.join(expandHome(rootDir), platform, name);
  }

  async writeProblem(
    detail: PlatformProblemDetail,
    options: WriteProblemOptions,
  ): Promise<WriteProblemResult> {
    const rawSlug = extractSlugFromUrl(detail.url) ?? detail.title;
    const problemDir = this.resolveProblemDir(
      detail.platform,
      detail.id,
      rawSlug,
      options.rootDir,
    );
    const slug = normalizeSlug(rawSlug, detail.id);

    let created = false;
    try {
      await fs.stat(problemDir);
    } catch {
      created = true;
    }
    await fs.mkdir(path.join(problemDir, 'cases'), { recursive: true });

    // problem.md
    await writeAtomic(path.join(problemDir, 'problem.md'), detail.statement, this.logger);

    // meta.json
    const now = new Date().toISOString();
    const meta: WorkspaceMeta = {
      platform: detail.platform,
      id: detail.id,
      title: detail.title,
      slug,
      url: detail.url,
      difficulty: detail.difficulty,
      tags: detail.tags,
      samples: detail.samples.map((s) => ({ input: s.input, output: s.output })),
      timeLimitMs: detail.timeLimitMs,
      memoryLimitKb: detail.memoryLimitKb,
      codeSnippets: detail.codeSnippets,
      fetchedAt: now,
      updatedAt: options.remoteUpdatedAt ?? now,
      statementHash: sha256(detail.statement),
      harnessSpec: detail.harnessSpec,
    };
    await writeAtomic(
      path.join(problemDir, 'meta.json'),
      JSON.stringify(meta, null, 2) + '\n',
      this.logger,
    );

    // cases
    for (let i = 0; i < detail.samples.length; i++) {
      const n = i + 1;
      await writeAtomic(
        path.join(problemDir, 'cases', `in_${n}.txt`),
        detail.samples[i]!.input ?? '',
        this.logger,
      );
      await writeAtomic(
        path.join(problemDir, 'cases', `out_${n}.txt`),
        detail.samples[i]!.output ?? '',
        this.logger,
      );
    }

    // solution.<ext> + 可选 harness.<ext>。
    // 已抽到 writeSolutionAndHarness,这里只是包一层,沿用之前 codeSnippet 优先级:
    //   problemLangs[lang].codeSnippet -> detail.codeSnippets[lang] -> defaultTemplate
    const lang = options.defaultLang ?? 'cpp';
    const snippet =
      options.problemLangs?.find((p) => p.lang === lang)?.codeSnippet ??
      detail.codeSnippets?.[lang === 'javascript' ? 'javascript' : lang];
    const { solutionPath } = await this.writeSolutionAndHarness(problemDir, {
      lang,
      snippet,
      harnessSpec: detail.harnessSpec,
      overwriteSolution: false,
    });

    this.logger.info('workspace', 'wrote problem', {
      problemDir,
      platform: detail.platform,
      id: detail.id,
      created,
    });

    return { problemDir, created, solutionPath };
  }

  /**
   * 仅写 solution.<ext> + 可选 harness.<ext>,不动 problem.md / meta.json / cases。
   *
   * 用途:vscode "切换语言" 路径——题目已经拉过,用户改语言时只需补对应文件。
   *
   * 规则:
   *   - 文件名:函数题 + Java -> Solution.java; 函数题 + 其他语言 -> solution.<ext>;
   *            非函数题 + Java -> Main.java; 其他 -> solution.<ext>
   *   - solution 默认不覆盖(尊重用户已写的代码),传 overwriteSolution=true 才覆盖
   *   - snippet 缺省时用 defaultTemplate
   *   - harness 总是覆盖(确定性生成,且依赖 snippet/spec)
   */
  async writeSolutionAndHarness(
    problemDir: string,
    opts: {
      lang: DefaultLang;
      snippet?: string;
      harnessSpec?: HarnessSpec;
      overwriteSolution?: boolean;
    },
  ): Promise<{ solutionPath: string; harnessPath?: string; solutionCreated: boolean }> {
    const { lang, snippet, harnessSpec, overwriteSolution = false } = opts;
    await fs.mkdir(problemDir, { recursive: true });

    const isFunctionProblem = harnessSpec?.kind === 'function';
    const ext = LANG_EXT[lang];
    const solutionName =
      lang === 'java'
        ? (isFunctionProblem ? 'Solution.java' : 'Main.java')
        : `solution.${ext}`;
    const solutionPath = path.join(problemDir, solutionName);
    const existed = await exists(solutionPath);
    let solutionCreated = false;
    if (!existed || overwriteSolution) {
      const content = snippet ?? defaultTemplate(lang);
      await writeAtomic(solutionPath, content, this.logger);
      solutionCreated = !existed;
    }

    await this.writeHarnessIfApplicable(problemDir, harnessSpec, lang);

    // 计算 harnessPath(若生成了)用于回传
    const harnessFile =
      isFunctionProblem
        ? lang === 'java'
          ? 'Harness.java'
          : lang === 'cpp'
          ? 'harness.cpp'
          : lang === 'python3'
          ? 'harness.py'
          : lang === 'javascript'
          ? 'harness.js'
          : undefined
        : undefined;
    const harnessPath = harnessFile ? path.join(problemDir, harnessFile) : undefined;
    return { solutionPath, harnessPath, solutionCreated };
  }

  /**
   * 若 spec 是函数题且 lang 有对应 harness 生成器,则写 harness.<ext>。
   * 不应用时静默跳过(adapter/Spec 不支持 / lang 暂未实现)。
   */
  private async writeHarnessIfApplicable(
    problemDir: string,
    spec: HarnessSpec | undefined,
    lang: DefaultLang,
  ): Promise<void> {
    if (!spec || spec.kind !== 'function') return;
    let src: string | undefined;
    let filename: string | undefined;
    switch (lang) {
      case 'cpp':
        src = generateCppHarness(spec);
        filename = 'harness.cpp';
        break;
      case 'python3':
        src = generatePythonHarness(spec);
        filename = 'harness.py';
        break;
      case 'javascript':
        src = generateJsHarness(spec);
        filename = 'harness.js';
        break;
      case 'java':
        src = generateJavaHarness(spec);
        filename = 'Harness.java';
        break;
      // c 暂不支持(LeetCode C snippet 用 malloc 风格签名,与 C++ 差异大,后续 change)
      default:
        return;
    }
    if (!src || !filename) return;
    await writeAtomic(path.join(problemDir, filename), src, this.logger);
  }

  async readMeta(problemDir: string): Promise<WorkspaceMeta | undefined> {
    const p = path.join(problemDir, 'meta.json');
    try {
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw) as WorkspaceMeta;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return undefined;
      this.logger.warn('workspace', 'meta.json 解析失败', { problemDir, error: err.message });
      return undefined;
    }
  }

  /**
   * 根据远端 detail 判断是否需要刷新本地题面与样例;
   * 保留 solution.* 与编号大于 N 的自定义 case。
   */
  async refresh(
    detail: PlatformProblemDetail,
    problemDir: string,
  ): Promise<{ refreshed: boolean }> {
    const meta = await this.readMeta(problemDir);
    if (meta) {
      const remoteHash = sha256(detail.statement);
      if (
        meta.statementHash === remoteHash &&
        meta.samples.length === detail.samples.length &&
        meta.samples.every(
          (s, i) =>
            s.input === detail.samples[i]?.input && s.output === detail.samples[i]?.output,
        )
      ) {
        return { refreshed: false };
      }
    }

    // 覆盖 problem.md / meta.json
    await writeAtomic(path.join(problemDir, 'problem.md'), detail.statement, this.logger);
    const now = new Date().toISOString();
    const newMeta: WorkspaceMeta = {
      platform: detail.platform,
      id: detail.id,
      title: detail.title,
      slug: meta?.slug ?? normalizeSlug(detail.title, detail.id),
      url: detail.url,
      difficulty: detail.difficulty,
      tags: detail.tags,
      samples: detail.samples.map((s) => ({ input: s.input, output: s.output })),
      timeLimitMs: detail.timeLimitMs,
      memoryLimitKb: detail.memoryLimitKb,
      codeSnippets: detail.codeSnippets,
      fetchedAt: meta?.fetchedAt ?? now,
      updatedAt: now,
      statementHash: sha256(detail.statement),
      customCaseIndices: meta?.customCaseIndices,
      harnessSpec: detail.harnessSpec,
    };
    await writeAtomic(
      path.join(problemDir, 'meta.json'),
      JSON.stringify(newMeta, null, 2) + '\n',
      this.logger,
    );

    // 覆盖 cases/in_1..N / out_1..N(N = 远端 sample 数量)
    await fs.mkdir(path.join(problemDir, 'cases'), { recursive: true });
    for (let i = 0; i < detail.samples.length; i++) {
      const n = i + 1;
      await writeAtomic(
        path.join(problemDir, 'cases', `in_${n}.txt`),
        detail.samples[i]!.input ?? '',
        this.logger,
      );
      await writeAtomic(
        path.join(problemDir, 'cases', `out_${n}.txt`),
        detail.samples[i]!.output ?? '',
        this.logger,
      );
    }
    // 注意:编号 > N 的用户自定义 case 保留(不动 in_{N+1}.txt 等)

    // 刷新 harness:已存在的 harness.<ext> 按新 spec 重生成。不存在则不创建,避免给从未启用过 harness 的目录强加文件。
    if (detail.harnessSpec?.kind === 'function') {
      const langExtPairs: Array<{ lang: DefaultLang; file: string }> = [
        { lang: 'cpp', file: 'harness.cpp' },
        { lang: 'python3', file: 'harness.py' },
        { lang: 'javascript', file: 'harness.js' },
        { lang: 'java', file: 'Harness.java' },
      ];
      for (const { lang, file } of langExtPairs) {
        if (await exists(path.join(problemDir, file))) {
          await this.writeHarnessIfApplicable(problemDir, detail.harnessSpec, lang);
        }
      }
    }

    this.logger.info('workspace', 'refreshed problem', { problemDir });
    return { refreshed: true };
  }

  /**
   * 追加自定义用例。
   * 编号 = 当前 cases/ 下 in_<n>.txt 的最大 n + 1。
   * 记录到 meta.customCaseIndices(不污染 meta.samples,后者只反映远端题面 sample)。
   */
  async addCustomCase(
    problemDir: string,
    input: string,
    output?: string,
  ): Promise<number> {
    const casesDir = path.join(problemDir, 'cases');
    await fs.mkdir(casesDir, { recursive: true });
    const files = await fs.readdir(casesDir).catch(() => [] as string[]);
    let maxN = 0;
    for (const f of files) {
      const m = f.match(/^in_(\d+)\.txt$/);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    const next = maxN + 1;
    await writeAtomic(path.join(casesDir, `in_${next}.txt`), input, this.logger);
    if (output !== undefined) {
      await writeAtomic(path.join(casesDir, `out_${next}.txt`), output, this.logger);
    }
    // 仅在 meta.customCaseIndices 中记录;不动 meta.samples(远端样例)。
    const meta = await this.readMeta(problemDir);
    if (meta) {
      const indices = meta.customCaseIndices ?? [];
      if (!indices.includes(next)) indices.push(next);
      meta.customCaseIndices = indices;
      meta.updatedAt = new Date().toISOString();
      await writeAtomic(
        path.join(problemDir, 'meta.json'),
        JSON.stringify(meta, null, 2) + '\n',
        this.logger,
      );
    }
    return next;
  }

  /**
   * 删除一个自定义用例。仅允许删除 meta.customCaseIndices 中登记的编号。
   * 同时清理 cases/in_<n>.txt 与 cases/out_<n>.txt。
   * @returns 实际删除时为 true;若 index 不在自定义列表则返回 false(不做任何操作)。
   */
  async removeCustomCase(problemDir: string, index: number): Promise<boolean> {
    if (!Number.isInteger(index) || index <= 0) return false;
    const meta = await this.readMeta(problemDir);
    const indices = meta?.customCaseIndices ?? [];
    if (!indices.includes(index)) return false;
    const casesDir = path.join(problemDir, 'cases');
    await fs.unlink(path.join(casesDir, `in_${index}.txt`)).catch(() => { /* ignore */ });
    await fs.unlink(path.join(casesDir, `out_${index}.txt`)).catch(() => { /* ignore */ });
    if (meta) {
      meta.customCaseIndices = indices.filter((n) => n !== index);
      meta.updatedAt = new Date().toISOString();
      await writeAtomic(
        path.join(problemDir, 'meta.json'),
        JSON.stringify(meta, null, 2) + '\n',
        this.logger,
      );
    }
    return true;
  }
}

async function writeAtomic(filePath: string, content: string, logger: LoggerBackend): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // LF 换行,UTF-8 无 BOM
  const normalized = content.replace(/\r\n/g, '\n');
  const tmp = filePath + '.tmp-' + Math.random().toString(36).slice(2, 8);
  try {
    await fs.writeFile(tmp, normalized, 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (e) {
    logger.warn('workspace', 'atomic write failed', { filePath, error: (e as Error).message });
    // 清理临时文件
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, p.slice(2));
  }
  return p;
}

function extractSlugFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // LeetCode: https://leetcode.cn/problems/two-sum/
  const lc = url.match(/leetcode\.\w+\/problems\/([^/]+)/);
  if (lc) return lc[1];
  // HDOJ url 没有 slug,返回 undefined
  return undefined;
}

function defaultTemplate(lang: DefaultLang): string {
  switch (lang) {
    case 'cpp':
      return '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // TODO: 在此处编写代码\n    return 0;\n}\n';
    case 'c':
      return '#include <stdio.h>\n\nint main(void) {\n    // TODO: 在此处编写代码\n    return 0;\n}\n';
    case 'python3':
      return '# TODO: 在此处编写代码\n';
    case 'java':
      return 'public class Main {\n    public static void main(String[] args) {\n        // TODO: 在此处编写代码\n    }\n}\n';
    case 'javascript':
      return '// TODO: 在此处编写代码\n';
  }
}
