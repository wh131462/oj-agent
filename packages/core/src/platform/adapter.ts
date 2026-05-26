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
  /**
   * 函数题 harness 规范（如 LeetCode）。已归一化的结构，与原始 metaData 解耦。
   * - kind=function:可生成 harness 文件,本地能跑出 verdict
   * - kind=unsupported:平台不支持本地判题(systemdesign / 未知类型等),不生成 harness
   * - undefined:此平台无函数题概念(ACM 全程序模式),按 stdin/stdout 跑即可
   */
  readonly harnessSpec?: import('../judge/harness/spec.js').HarnessSpec;
}

/**
 * 题目级语言能力描述。由 PlatformAdapter.getProblemLangs 返回。
 *
 * 不是所有平台都能提供题目级语言列表（POJ/HDU/CF 等平台级一致，无此能力）。
 * 调用方应在 getProblemLangs 未实现时回退到 adapter.supportedLangs。
 */
export interface ProblemLangInfo {
  /** 与 adapter.supportedLangs 中的字符串一致（如 `cpp` / `python3`）。 */
  readonly lang: string;
  /** UI 展示用的可读名称（如 `C++` / `Python3` / `JavaScript`）。 */
  readonly displayName: string;
  /**
   * 平台提交时实际需要回传的语言标识。
   * 统一为 string；平台内部需要 number 时自行 Number() 转换。
   */
  readonly platformLangId: string;
  /** 平台提供的初始代码模板（如 LeetCode 的函数签名片段），可空。 */
  readonly codeSnippet?: string;
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
  /**
   * 平台静态支持的语言集合。
   *
   * 用作 UI 语言选择与提交链路的兜底来源。注意：这是“平台能提交”的语言集合，
   * 与“本地工具链能编译运行”的集合是两件事；本地评测应取两者的交集。
   *
   * 字符串语义由各 adapter 自行约定，与提交时传入 `submit(id, lang, code)` 的
   * lang 参数保持一致即可（例如 `cpp` / `c` / `python3` / `java` / `javascript`
   * / `go` / `rust` / `kotlin` 等）。
   */
  readonly supportedLangs: readonly string[];
  login(): Promise<PlatformCredential>;
  listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]>;
  getProblem(id: string): Promise<PlatformProblemDetail>;
  /**
   * 题目级语言能力查询（可选）。
   *
   * 已实现的 adapter（如 LeetCode）会返回该题真实支持的语言及初始模板；
   * 未实现时调用方应回退到 adapter.supportedLangs 作为兜底。
   */
  getProblemLangs?(id: string): Promise<ProblemLangInfo[]>;
  /**
   * 提交代码。
   *
   * @param platformLangId 由调用方通过 getProblemLangs() 预先解析得到的平台原生语言标识。
   *   提供时 adapter 应直接使用此值（避免内部 LANG_MAP 静默腐烂）；
   *   未提供时 adapter 回退到自身的静态语言映射作为兼容路径。
   */
  submit(
    id: string,
    lang: string,
    code: string,
    platformLangId?: string,
  ): Promise<PlatformSubmissionId>;
  pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult>;
}
