export interface SecretBackend {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const AI_KEY_PREFIX = 'ai.apiKey.';

function buildKey(profileId: string): string {
  if (!profileId || /[^a-z0-9-]/.test(profileId)) {
    throw new Error(`非法 profileId: ${profileId}`);
  }
  return `${AI_KEY_PREFIX}${profileId}`;
}

export class ApiKeyVault {
  constructor(private readonly backend: SecretBackend) {}

  async get(profileId: string): Promise<string | undefined> {
    return this.backend.get(buildKey(profileId));
  }

  async set(profileId: string, apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim().length === 0) throw new Error('apiKey 不能为空');
    await this.backend.store(buildKey(profileId), apiKey.trim());
  }

  async delete(profileId: string): Promise<void> {
    await this.backend.delete(buildKey(profileId));
  }

  async has(profileId: string): Promise<boolean> {
    return (await this.get(profileId)) !== undefined;
  }

  /** 用于设置面板掩码显示。 */
  mask(apiKey: string | undefined): string {
    if (!apiKey) return '';
    const tail = apiKey.slice(-4);
    return `${apiKey.slice(0, 3)}****${tail}`;
  }
}
