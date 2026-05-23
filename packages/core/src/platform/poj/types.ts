/**
 * POJ 平台类型定义。
 */

import type { PlatformVerdict } from '../adapter.js';

export interface PojListRow {
  id: string;
  title: string;
  /** 形如 "23.45%" 的 AC 比例 */
  ratio?: string;
}

export interface PojStatusRow {
  runId: string;
  user?: string;
  problem?: string;
  verdict: PlatformVerdict;
  rawStatus: string;
  language?: string;
  timeMs?: number;
  memoryKb?: number;
}
