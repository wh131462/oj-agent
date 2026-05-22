/** 测试用内存 SecretBackend。 */
import type { SecretBackend } from '../../src/ai/api-key-vault.js';

export class MemorySecretBackend implements SecretBackend {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  /** 测试辅助:列出所有 key */
  keys(): string[] {
    return [...this.map.keys()];
  }
}
