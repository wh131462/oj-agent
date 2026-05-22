import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ProblemDetail, WorkspaceMeta, JudgeLang } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { findProblemDir } from '../utils/workspace-resolver.js';
import { inferLangFromDir } from '../commands/judge.js';

export interface ProblemContextResult {
  problem: ProblemDetail;
  code?: string;
  language: JudgeLang;
  problemDir: string;
}

export class ProblemContextProvider {
  constructor(
    private readonly getRoot: () => string,
    private readonly getDefaultLang: () => JudgeLang,
  ) {}

  async get(ref: ProblemRef): Promise<ProblemContextResult | undefined> {
    const root = this.getRoot();
    const dir = await findProblemDir(root, ref);
    if (!dir) return undefined;
    let meta: WorkspaceMeta | undefined;
    try {
      const raw = await fs.readFile(path.join(dir, 'meta.json'), 'utf-8');
      meta = JSON.parse(raw) as WorkspaceMeta;
    } catch {
      return undefined;
    }
    let statement = '';
    try {
      statement = await fs.readFile(path.join(dir, 'problem.md'), 'utf-8');
    } catch {
      statement = '(题面缺失)';
    }
    const lang = await inferLangFromDir(dir, this.getDefaultLang());
    let code: string | undefined;
    try {
      const filename = lang === 'java' ? 'Main.java' : `solution.${langExt(lang)}`;
      code = await fs.readFile(path.join(dir, filename), 'utf-8');
    } catch {
      /* ignore */
    }

    const problem: ProblemDetail = {
      platform: ref.platform,
      problemId: ref.id,
      title: meta.title,
      statement,
      samples: (meta.samples ?? []).map((s) => ({
        input: s.input,
        expectedOutput: s.output,
      })),
      language: lang,
    };

    return { problem, code, language: lang, problemDir: dir };
  }
}

function langExt(lang: JudgeLang): string {
  return lang === 'cpp' ? 'cpp' : lang === 'python3' ? 'py' : lang === 'javascript' ? 'js' : 'cpp';
}
