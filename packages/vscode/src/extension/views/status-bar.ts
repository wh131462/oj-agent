import * as vscode from 'vscode';
import type { PlatformVerdict, CredentialStore, PlatformId } from '@oj-agent/core';
import type { VSCodeConfigBackend } from '../backends/vscode-config.js';
import { getEnabledPlatforms } from '../oj-services.js';

/**
 * 聚合 OJ 状态栏。display 序列:
 *   idle('$(rocket) OJ-Agent') →
 *   submitting('$(sync~spin) 提交中...') →
 *   judging('$(sync~spin) Judging...') →
 *   verdict(短文本 5s) → 短摘要(10s) → idle
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private verdictTimer?: NodeJS.Timeout;
  private hideTimer?: NodeJS.Timeout;
  private loginMap = new Map<PlatformId, 'valid' | 'expired' | 'unknown'>();

  constructor(private readonly cfg: VSCodeConfigBackend) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'ojAgent.statusBar.openQuickPick';
    this.setIdle();
    this.updateVisibility();
  }

  /** 把 credentialStore 与本管理器粘起来。 */
  attachCredential(store: CredentialStore): vscode.Disposable {
    void this.initLoginMap(store);
    return store.onChange((platform) => {
      void store.get(platform).then((c) => {
        this.loginMap.set(platform, c?.cookie ? 'valid' : 'expired');
        this.refreshTooltip();
      });
    });
  }

  setIdle(): void {
    this.clearTimers();
    this.item.text = '$(rocket) OJ-Agent';
    this.refreshTooltip();
    this.item.backgroundColor = undefined;
  }

  setSubmitting(): void {
    this.clearTimers();
    this.item.text = '$(sync~spin) 提交中...';
    this.refreshTooltip();
  }

  setJudging(): void {
    this.clearTimers();
    this.item.text = '$(sync~spin) Judging...';
    this.refreshTooltip();
  }

  setVerdict(verdict: PlatformVerdict, ms?: number): void {
    this.clearTimers();
    const icon = verdict === 'AC' ? '$(check)' : '$(error)';
    const tail = ms !== undefined ? ` ${ms}ms` : '';
    this.item.text = `${icon} ${verdict}${tail}`;
    this.item.backgroundColor = verdict === 'AC'
      ? undefined
      : new vscode.ThemeColor('statusBarItem.errorBackground');
    // 5s 后切短摘要(再持续 10s),然后回 idle
    this.verdictTimer = setTimeout(() => {
      this.item.text = `${icon} ${verdict}`;
      this.hideTimer = setTimeout(() => this.setIdle(), 10_000);
    }, 5_000);
  }

  updateVisibility(): void {
    const enabled = getEnabledPlatforms(this.cfg);
    if (enabled.length === 0) {
      this.item.hide();
    } else {
      this.item.show();
    }
  }

  dispose(): void {
    this.clearTimers();
    this.item.dispose();
  }

  private clearTimers(): void {
    if (this.verdictTimer) clearTimeout(this.verdictTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.verdictTimer = undefined;
    this.hideTimer = undefined;
    this.item.backgroundColor = undefined;
  }

  private async initLoginMap(store: CredentialStore): Promise<void> {
    for (const p of getEnabledPlatforms(this.cfg)) {
      try {
        const c = await store.get(p);
        this.loginMap.set(p, c?.cookie ? 'valid' : 'expired');
      } catch {
        this.loginMap.set(p, 'unknown');
      }
    }
    this.refreshTooltip();
  }

  private refreshTooltip(): void {
    const parts: string[] = ['OJ-Agent 状态'];
    for (const [p, s] of this.loginMap) {
      const mark = s === 'valid' ? '✓' : '✗';
      parts.push(`${mark} ${p}`);
    }
    this.item.tooltip = parts.join('\n');
  }
}
