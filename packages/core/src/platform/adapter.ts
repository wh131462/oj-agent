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

/** 平台能力集合，声明适配器支持哪些操作。 */
export interface PlatformCapabilities {
  /** 是否支持无需登录的题目列表拉取 */
  readonly listProblems: boolean;
  /** 是否支持题目详情拉取（无需登录） */
  readonly getProblem: boolean;
  /** 是否支持提交（通常需要登录） */
  readonly submit: boolean;
  /** 是否支持轮询判题结果 */
  readonly pollResult: boolean;
  /** 是否支持自动登录流程 */
  readonly autoLogin: boolean;
}

/** 降级信息：当某能力不完全可用时描述原因与建议。 */
export interface PlatformDegradedInfo {
  /** 受影响的能力名称 */
  readonly capability: keyof PlatformCapabilities;
  /** 降级原因 */
  readonly reason: string;
  /** 对用户的提示 */
  readonly hint?: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  /** 平台能力声明 */
  readonly capabilities: PlatformCapabilities;
  /** 降级说明（可选，描述有限制的能力） */
  readonly degraded?: PlatformDegradedInfo[];
  login(): Promise<PlatformCredential>;
  listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]>;
  getProblem(id: string): Promise<PlatformProblemDetail>;
  submit(id: string, lang: string, code: string): Promise<PlatformSubmissionId>;
  pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult>;
}
