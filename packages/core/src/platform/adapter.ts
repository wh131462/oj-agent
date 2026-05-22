/**
 * 平台适配器统一接口契约。
 *
 * 各 OJ 平台（LeetCode CN / HDOJ / Codeforces / 洛谷 / POJ / 蓝桥）的具体实现
 * 由后续 change 在 packages/core/src/platform/<vendor>/ 下提供，此文件仅定义类型。
 */

export type PlatformId =
  | 'leetcode-cn'
  | 'hdoj'
  | 'codeforces'
  | 'luogu'
  | 'poj'
  | 'lanqiao';

export interface PlatformCredential {
  readonly platform: PlatformId;
  readonly cookie?: string;
  readonly token?: string;
  readonly extra?: Record<string, string>;
}

export interface PlatformProblemSummary {
  readonly platform: PlatformId;
  readonly id: string;
  readonly title: string;
  readonly difficulty?: string;
  readonly tags?: string[];
  readonly url?: string;
}

export interface PlatformSampleCase {
  readonly input: string;
  readonly output: string;
}

export interface PlatformProblemDetail extends PlatformProblemSummary {
  readonly statement: string;
  readonly samples: PlatformSampleCase[];
  readonly codeSnippets?: Record<string, string>;
  readonly timeLimitMs?: number;
  readonly memoryLimitKb?: number;
}

export interface PlatformListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly keyword?: string;
  readonly difficulty?: string;
  readonly tags?: string[];
}

export type PlatformSubmissionId = string;

export type PlatformVerdict =
  | 'AC'
  | 'WA'
  | 'TLE'
  | 'MLE'
  | 'RE'
  | 'CE'
  | 'PE'
  | 'PENDING'
  | 'JUDGING'
  | 'UNKNOWN';

export interface PlatformJudgeResult {
  readonly submissionId: PlatformSubmissionId;
  readonly verdict: PlatformVerdict;
  readonly timeMs?: number;
  readonly memoryKb?: number;
  readonly passedCases?: number;
  readonly totalCases?: number;
  readonly message?: string;
  readonly compileError?: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  login(): Promise<PlatformCredential>;
  listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]>;
  getProblem(id: string): Promise<PlatformProblemDetail>;
  submit(id: string, lang: string, code: string): Promise<PlatformSubmissionId>;
  pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult>;
}
