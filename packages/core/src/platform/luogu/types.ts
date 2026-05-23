/**
 * 洛谷平台类型定义。
 *
 * 数据来源：页面 `<script id="lentille-context" type="application/json">` 中内嵌的 JSON。
 */

export interface LuoguTagInfo {
  id: number;
  name?: string;
}

export interface LuoguProblemListItem {
  pid: string;
  /** 洛谷 lentille-context 实际字段名为 name；保留 title 仅作向后兼容 */
  name?: string;
  title?: string;
  difficulty: number;
  fullScore?: number;
  tags?: number[];
  totalSubmit?: number;
  totalAccepted?: number;
  /** 'official' | 'user' 等来源标识 */
  provider?: { name?: string; type?: string };
}

export interface LuoguProblemDetailRaw {
  pid: string;
  name?: string;
  title?: string;
  difficulty: number;
  tags?: number[];
  fullScore?: number;
  type?: string;
  contenu?: {
    /** Markdown 题面，含 LaTeX */
    content: string;
  };
  /** 题面拆分字段（新版洛谷 API 返回） */
  background?: string;
  description?: string;
  inputFormat?: string;
  outputFormat?: string;
  hint?: string;
  samples?: Array<[string, string]>; // [input, output]
  limits?: {
    time?: number[]; // ms per testcase group
    memory?: number[]; // KB
  };
  translation?: string;
}

export interface LentilleProblemListContext {
  data: {
    problems?: {
      count: number;
      result: LuoguProblemListItem[];
    };
  };
}

export interface LentilleProblemDetailContext {
  data: {
    problem: LuoguProblemDetailRaw;
  };
}

/**
 * 难度数字映射到字符串：洛谷难度有 0..7。
 * 0=暂无评定，1=入门，2=普及-，3=普及/提高-，4=普及+/提高，5=提高+/省选-，6=省选/NOI-，7=NOI/NOI+/CTSC
 */
export function difficultyLabel(d: number | undefined): string | undefined {
  if (d === undefined) return undefined;
  switch (d) {
    case 0:
      return '暂无评定';
    case 1:
      return '入门';
    case 2:
      return '普及-';
    case 3:
      return '普及/提高-';
    case 4:
      return '普及+/提高';
    case 5:
      return '提高+/省选-';
    case 6:
      return '省选/NOI-';
    case 7:
      return 'NOI/NOI+/CTSC';
    default:
      return String(d);
  }
}
