/**
 * 蓝桥云课平台类型定义。
 */

export interface LanqiaoListItem {
  id: number | string;
  /** 蓝桥 API 实际字段名为 name */
  name?: string;
  /** 保留 title 兼容字段（部分接口或历史 fixture 可能使用） */
  title?: string;
  /** 列表里的 difficulty 是考分（如 30），用于显示分值；难度等级用 difficulty_level（1-4） */
  difficulty?: number;
  difficulty_level?: number;
  tags?: string[];
}

export interface LanqiaoListResponse {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: LanqiaoListItem[];
}

export interface LanqiaoProblemDetailRaw {
  id: number | string;
  title?: string;
  display_id?: string;
  description?: string;
  input?: string;
  output?: string;
  hint?: string;
  examples?: Array<{ input?: string; output?: string }>;
  difficulty?: number;
  tags?: string[];
  time_limit?: number; // ms
  memory_limit?: number; // KB
}

export function difficultyLabel(d: number | undefined): string | undefined {
  if (d === undefined) return undefined;
  switch (d) {
    case 1:
      return '入门';
    case 2:
      return '简单';
    case 3:
      return '中等';
    case 4:
      return '困难';
    default:
      return String(d);
  }
}
