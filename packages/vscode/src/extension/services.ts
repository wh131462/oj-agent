import * as vscode from 'vscode';
import { ProfileStore, ApiKeyVault, RateLimiter, AIRunner } from '@oj-agent/core';

const CFG_NS = 'ojAgent';
const CFG_NS_AI = 'ojAgent.ai';

class VSCodeConfigBackend {
  get<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration(CFG_NS).get<T>(key);
  }
  async update<T>(key: string, value: T): Promise<void> {
    await vscode.workspace
      .getConfiguration(CFG_NS)
      .update(key, value, vscode.ConfigurationTarget.Global);
  }
}

class VSCodeSecretBackend {
  constructor(private readonly storage: vscode.SecretStorage) {}
  get(key: string) {
    return Promise.resolve(this.storage.get(key));
  }
  store(key: string, value: string) {
    return Promise.resolve(this.storage.store(key, value));
  }
  delete(key: string) {
    return Promise.resolve(this.storage.delete(key));
  }
}

export interface AIServices {
  profiles: ProfileStore;
  vault: ApiKeyVault;
  runner: AIRunner;
  limiter: RateLimiter;
}

export function buildAIServices(ctx: vscode.ExtensionContext): AIServices {
  const profiles = new ProfileStore(new VSCodeConfigBackend());
  const vault = new ApiKeyVault(new VSCodeSecretBackend(ctx.secrets));
  const limiter = new RateLimiter((_bucket) => {
    const v = vscode.workspace.getConfiguration(CFG_NS_AI).get<number>('rateLimit.perMinute');
    return typeof v === 'number' && v > 0 ? v : 20;
  });
  const runner = new AIRunner(limiter);
  return { profiles, vault, runner, limiter };
}

export function isRedactEnabled(): boolean {
  const v = vscode.workspace.getConfiguration(CFG_NS_AI).get<boolean>('privacy.redact');
  return v !== false;
}
