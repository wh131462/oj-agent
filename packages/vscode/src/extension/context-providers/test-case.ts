import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { FailedCase, JudgeRunResult } from '@oj-agent/core';
import type { ProblemRef } from '../utils/problem-ref.js';
import { problemRefKey } from '../utils/problem-ref.js';

/**
 * 维护每个题目最近一次本地测试结果的缓存,供 AI explainError 在拼装上下文时
 * 取出对应 caseIndex 的 input/expected/actual/diff。
 */
export class TestCaseContextProvider {
  private readonly lastResults = new Map<string, JudgeRunResult>();
  private readonly lastDirs = new Map<string, string>();

  record(ref: ProblemRef, result: JudgeRunResult, problemDir?: string): void {
    this.lastResults.set(problemRefKey(ref), result);
    if (problemDir) this.lastDirs.set(problemRefKey(ref), problemDir);
  }

  /**
   * 根据 ref + caseIndex 取出失败用例上下文。
   * input 从 problemDir/cases/in_<n>.txt 读取(JudgeCaseResult 本身不带 input)。
   */
  async get(ref: ProblemRef, caseIndex?: number): Promise<FailedCase | undefined> {
    const key = problemRefKey(ref);
    const result = this.lastResults.get(key);
    if (!result) return undefined;
    let target = result.cases.find((c) => c.verdict !== 'AC');
    if (typeof caseIndex === 'number') {
      target = result.cases.find((c) => c.index === caseIndex) ?? target;
    }
    if (!target) return undefined;
    const dir = this.lastDirs.get(key);
    let input = '';
    if (dir) {
      try {
        input = await fs.readFile(path.join(dir, 'cases', `in_${target.index}.txt`), 'utf-8');
      } catch {
        /* leave empty */
      }
    }
    return {
      input,
      expectedOutput: target.expected ?? '',
      actualOutput: target.stdout,
      diff: target.diff?.unifiedDiff,
    };
  }

  getLatest(ref: ProblemRef): JudgeRunResult | undefined {
    return this.lastResults.get(problemRefKey(ref));
  }
}
