import type { ProblemDetail, FailedCase } from './context-builder.js';

export function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TruncatableContext {
  problem: ProblemDetail;
  code?: string;
  failedCase?: FailedCase;
  /** 其他可选样例（除 failedCase 外） */
  extraSamples?: ProblemDetail['samples'];
}

export interface TruncatedResult {
  context: TruncatableContext;
  omitted: {
    code: boolean;
    extraSamples: number;
    failedCaseTruncated: boolean;
  };
}

/** 优先级：题面 > 首个失败用例摘要 > 当前代码 > 其余样例。 */
export function truncate(ctx: TruncatableContext, maxInputTokens: number): TruncatedResult {
  const omitted = { code: false, extraSamples: 0, failedCaseTruncated: false };
  const sized = (s: string | undefined) => (s ? tokenEstimate(s) : 0);
  let budget = maxInputTokens;

  budget -= tokenEstimate(ctx.problem.statement);
  budget -= tokenEstimate(ctx.problem.title);

  // 失败用例（必保留首个 failedCase）
  if (ctx.failedCase) budget -= sized(ctx.failedCase.input) + sized(ctx.failedCase.expectedOutput) + sized(ctx.failedCase.actualOutput) + sized(ctx.failedCase.diff);

  // 代码
  if (ctx.code) {
    const codeCost = tokenEstimate(ctx.code);
    if (codeCost > budget) {
      omitted.code = true;
      ctx = { ...ctx, code: undefined };
    } else {
      budget -= codeCost;
    }
  }

  // 其余样例
  const samples = ctx.extraSamples ?? [];
  const kept: typeof samples = [];
  for (const s of samples) {
    const cost = tokenEstimate(s.input) + tokenEstimate(s.expectedOutput);
    if (cost > budget) {
      omitted.extraSamples += samples.length - kept.length;
      break;
    }
    kept.push(s);
    budget -= cost;
  }

  // 题面与失败用例本身超额时，对失败用例摘要截断（保留前 2000 字）
  if (budget < 0 && ctx.failedCase) {
    omitted.failedCaseTruncated = true;
    const cap = (s: string) => (s.length > 2000 ? s.slice(0, 2000) + '\n...<truncated>' : s);
    ctx = {
      ...ctx,
      failedCase: {
        input: cap(ctx.failedCase.input),
        expectedOutput: cap(ctx.failedCase.expectedOutput),
        actualOutput: cap(ctx.failedCase.actualOutput),
        diff: ctx.failedCase.diff ? cap(ctx.failedCase.diff) : undefined,
      },
    };
  }

  return { context: { ...ctx, extraSamples: kept }, omitted };
}
