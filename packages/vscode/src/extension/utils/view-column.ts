import * as vscode from 'vscode';

/**
 * 选择打开代码文件的列：当前活动组无 tab 时复用之，否则在旁边分栏。
 * Why: 从题面 webview 触发"打开代码"时，避免覆盖 webview；同时在树视图直接调用、且当前编辑区为空时也不要白白多开一列。
 */
export function pickOpenColumn(): vscode.ViewColumn {
  const active = vscode.window.tabGroups.activeTabGroup;
  return active.tabs.length === 0 ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
}
