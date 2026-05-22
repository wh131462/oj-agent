import type { AIProfile, AIProvider } from './types.js';

export function kebab(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function generateUniqueId(label: string, existing: ReadonlyArray<string>): string {
  const base = kebab(label) || 'profile';
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

const TRAILING_PATHS = [
  '/v1/chat/completions',
  '/v1/messages',
  '/v1/',
  '/v1',
];

export function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let u = url.trim().replace(/\/+$/, '');
  if (u.length === 0) return undefined;
  for (const p of TRAILING_PATHS) {
    if (u.endsWith(p)) {
      u = u.slice(0, -p.length).replace(/\/+$/, '');
      break;
    }
  }
  return u;
}

const KEY_LIKE = /^(sk-|xai-|claude-key-|sk_)/i;
export function looksLikeApiKey(s: string | undefined): boolean {
  if (!s) return false;
  return KEY_LIKE.test(s.trim());
}

export interface ProfileValidation {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

export function validateProfile(
  draft: Partial<AIProfile>,
): { profile?: AIProfile; validation: ProfileValidation } {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!draft.label || draft.label.trim().length === 0) errors.push('label 不能为空');
  if (!draft.model || draft.model.trim().length === 0) errors.push('model 不能为空');
  const provider = draft.provider;
  if (provider !== 'openai' && provider !== 'anthropic') {
    errors.push("provider 必须是 'openai' 或 'anthropic'");
  }
  if (looksLikeApiKey(draft.model)) warnings.push('model 字段疑似 API Key，请检查是否填错');
  if (looksLikeApiKey(draft.label)) warnings.push('label 字段疑似 API Key，请检查是否填错');

  if (errors.length > 0) return { validation: { ok: false, warnings, errors } };

  const profile: AIProfile = {
    id: draft.id ?? '',
    label: draft.label!.trim(),
    provider: provider as AIProvider,
    baseUrl: normalizeBaseUrl(draft.baseUrl),
    model: draft.model!.trim(),
    temperature: draft.temperature ?? 0.2,
    maxOutputTokens: draft.maxOutputTokens ?? 2048,
    maxInputTokens: draft.maxInputTokens ?? 32000,
    requestTimeoutMs: draft.requestTimeoutMs ?? 60000,
    anthropicVersion: draft.anthropicVersion ?? '2023-06-01',
    extraHeaders: draft.extraHeaders ?? {},
  };
  return { profile, validation: { ok: true, warnings, errors } };
}
