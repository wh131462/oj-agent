import * as vscode from 'vscode';
import type { ConfigBackend } from '@oj-agent/core';

/**
 * VSCode 配置 backend。命名空间默认 `ojAgent`。
 *
 * 实现 core 的 `ConfigBackend`(get/update),并额外提供 `onChange(key, listener)`
 * 用于扩展端订阅细粒度配置变更(底层是 `workspace.onDidChangeConfiguration` 过滤)。
 */
export class VSCodeConfigBackend implements ConfigBackend {
  constructor(private readonly section: string = 'ojAgent') {}

  get<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration(this.section).get<T>(key);
  }

  getOr<T>(key: string, defaultValue: T): T {
    const v = vscode.workspace.getConfiguration(this.section).get<T>(key);
    return v === undefined ? defaultValue : v;
  }

  async update<T>(key: string, value: T): Promise<void> {
    await vscode.workspace
      .getConfiguration(this.section)
      .update(key, value, vscode.ConfigurationTarget.Global);
  }

  /**
   * 订阅指定 key 的变化。key 是相对 section 的子路径,例如 `'platforms.enabled'`,
   * 内部拼成 `'ojAgent.platforms.enabled'` 再调 `affectsConfiguration`。
   */
  onChange(key: string, listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${this.section}.${key}`)) {
        try {
          listener();
        } catch {
          /* ignore listener errors */
        }
      }
    });
  }
}
