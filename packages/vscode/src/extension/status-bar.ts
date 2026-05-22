import * as vscode from 'vscode';
import type { AIServices } from './services.js';

export function updateStatusBar(item: vscode.StatusBarItem, services: AIServices): void {
  const active = services.profiles.getActive();
  const redact = vscode.workspace.getConfiguration('ojAgent.ai').get<boolean>('privacy.redact');
  if (!active) {
    item.text = '$(robot) AI: 未配置';
    item.tooltip = '点击切换或新建 AI Profile';
  } else {
    const warn = redact === false ? '  $(warning) 脱敏 OFF' : '';
    item.text = `$(robot) AI: ${active.label}${warn}`;
    item.tooltip = `当前 Profile: ${active.label}\nProvider: ${active.provider}\nModel: ${active.model}`;
  }
  item.command = 'ojAgent.ai.switchProfile';
  item.show();
}
