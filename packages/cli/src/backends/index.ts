/**
 * Backend 装配。启动时尝试 keytar,失败回退 file。
 */

import * as path from 'node:path';
import type { SecretBackend } from '@oj-agent/core';
import { KeytarSecretBackend, tryLoadKeytar } from './keytar-secret.js';
import { FileSecretFallback } from './file-secret-fallback.js';
import { resolveConfigPath } from './toml-config.js';

export type SecretBackendKind = 'keytar' | 'file-fallback';

export interface SecretBackendInfo {
  backend: SecretBackend;
  kind: SecretBackendKind;
  /** file-fallback 时为绝对路径,否则为 null。 */
  filePath: string | null;
  warning?: string;
}

export async function createSecretBackend(opts: { configPath?: string } = {}): Promise<SecretBackendInfo> {
  const keytar = await tryLoadKeytar();
  if (keytar) {
    return { backend: new KeytarSecretBackend(keytar), kind: 'keytar', filePath: null };
  }
  const configPath = resolveConfigPath({ explicit: opts.configPath });
  const secretsPath = path.join(path.dirname(configPath), 'secrets.json');
  return {
    backend: new FileSecretFallback(secretsPath),
    kind: 'file-fallback',
    filePath: secretsPath,
    warning:
      '未检测到系统钥匙串(keytar 不可用),凭证将存于 ' + secretsPath + '(权限 0600)。',
  };
}
