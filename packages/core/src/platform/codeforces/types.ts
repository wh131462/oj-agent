/**
 * Codeforces 平台类型定义。
 */

export interface CodeforcesProblemRow {
  contestId: number;
  index: string;
  name: string;
  type?: string;
  rating?: number;
  tags?: string[];
}

export interface CodeforcesProblemStat {
  contestId: number;
  index: string;
  solvedCount: number;
}

export interface CodeforcesProblemsetResponse {
  status: 'OK' | 'FAILED';
  comment?: string;
  result?: {
    problems: CodeforcesProblemRow[];
    problemStatistics: CodeforcesProblemStat[];
  };
}

/**
 * 解析自题目 ID 串（形如 "1900A"）的 contestId + index。
 */
export function parseCfProblemId(id: string): { contestId: number; index: string } | undefined {
  const m = id.match(/^(\d+)([A-Z]\d?)$/i);
  if (!m) return undefined;
  return { contestId: Number(m[1]), index: m[2]!.toUpperCase() };
}

/** 把适配器层的难度枚举映射到 Codeforces rating 区间。 */
export function ratingToDifficulty(rating?: number): string | undefined {
  if (rating === undefined) return undefined;
  if (rating < 1200) return 'Easy';
  if (rating < 1900) return 'Medium';
  return 'Hard';
}
