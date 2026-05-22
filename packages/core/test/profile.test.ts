import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ProfileStore, type ConfigBackend } from '../src/ai/profile-store.js';
import { ApiKeyVault, AI_KEY_PREFIX, type SecretBackend } from '../src/ai/api-key-vault.js';
import { generateUniqueId, normalizeBaseUrl, looksLikeApiKey, validateProfile } from '../src/ai/profile-utils.js';

function memoryCfg(): ConfigBackend & { dump: () => Record<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return map.get(key) as T | undefined;
    },
    async update<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

function memorySecret(): SecretBackend & { keys: () => string[] } {
  const map = new Map<string, string>();
  return {
    async get(k: string) {
      return map.get(k);
    },
    async store(k: string, v: string) {
      map.set(k, v);
    },
    async delete(k: string) {
      map.delete(k);
    },
    keys: () => [...map.keys()],
  };
}

test('kebab-case id 生成与冲突', () => {
  assert.equal(generateUniqueId('OpenAI GPT-4o', []), 'openai-gpt-4o');
  assert.equal(generateUniqueId('OpenAI GPT-4o', ['openai-gpt-4o']), 'openai-gpt-4o-2');
  assert.equal(generateUniqueId('OpenAI GPT-4o', ['openai-gpt-4o', 'openai-gpt-4o-2']), 'openai-gpt-4o-3');
});

test('baseUrl 规范化剥离冗余尾段', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/messages/'), 'https://api.example.com');
  assert.equal(normalizeBaseUrl('https://api.example.com'), 'https://api.example.com');
  assert.equal(normalizeBaseUrl(''), undefined);
  assert.equal(normalizeBaseUrl(undefined), undefined);
});

test('looksLikeApiKey 识别常见 Key 前缀', () => {
  assert.equal(looksLikeApiKey('sk-abcdefghij'), true);
  assert.equal(looksLikeApiKey('xai-xx'), true);
  assert.equal(looksLikeApiKey('claude-key-xx'), true);
  assert.equal(looksLikeApiKey('gpt-4o'), false);
  assert.equal(looksLikeApiKey(undefined), false);
});

test('validateProfile: 缺少必填字段时报错', () => {
  const r = validateProfile({ label: '', model: '', provider: 'openai' });
  assert.equal(r.profile, undefined);
  assert.ok(r.validation.errors.length >= 2);
});

test('ProfileStore: 增删改查 + 自动切活动', async () => {
  const cfg = memoryCfg();
  const store = new ProfileStore(cfg);
  assert.equal(store.list().length, 0);
  const { profile: p1 } = await store.add({ label: 'A', provider: 'openai', model: 'gpt-4o' });
  assert.equal(p1.id, 'a');
  assert.equal(store.getActiveId(), 'a');

  const { profile: p2 } = await store.add({ label: 'B', provider: 'anthropic', model: 'claude' });
  assert.equal(p2.id, 'b');
  assert.equal(store.list().length, 2);

  await store.update('a', { model: 'gpt-4o-mini' });
  assert.equal(store.list()[0].model, 'gpt-4o-mini');

  await store.remove('a');
  assert.equal(store.list().length, 1);
  assert.equal(store.getActiveId(), 'b');
});

test('ProfileStore: 不写入 apiKey 字段', async () => {
  const cfg = memoryCfg();
  const store = new ProfileStore(cfg);
  await store.add({ label: 'X', provider: 'openai', model: 'm', extraHeaders: {} } as any);
  const dump = cfg.dump();
  const json = JSON.stringify(dump);
  assert.equal(json.includes('apiKey'), false, 'profiles 序列化中不应出现 apiKey 字段');
});

test('ApiKeyVault: 与 OJ 凭证命名空间隔离', async () => {
  const secret = memorySecret();
  const vault = new ApiKeyVault(secret);
  await vault.set('openai-1', 'sk-xxx');
  await vault.set('claude-1', 'sk-ant-yyy');
  // 模拟 OJ 凭证写入（业务侧应使用 oj.cred.* 前缀）
  await secret.store('oj.cred.leetcode', 'cookie-zzz');
  const all = secret.keys();
  const aiKeys = all.filter((k) => k.startsWith(AI_KEY_PREFIX));
  assert.equal(aiKeys.length, 2);
  for (const k of all) {
    assert.ok(k.startsWith(AI_KEY_PREFIX) || k.startsWith('oj.cred.'), `unexpected key: ${k}`);
  }
});

test('ApiKeyVault: 拒绝非法 profileId', async () => {
  const vault = new ApiKeyVault(memorySecret());
  await assert.rejects(() => vault.set('Bad Id!', 'k'));
});

test('ApiKeyVault: mask 仅保留尾 4 位', () => {
  const v = new ApiKeyVault(memorySecret());
  assert.equal(v.mask('sk-12345678abcd'), 'sk-****abcd');
});
