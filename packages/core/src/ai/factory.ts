import { AnthropicAdapter } from './anthropic-adapter.js';
import { OpenAIAdapter } from './openai-adapter.js';
import type { AIProfile, AIProviderAdapter } from './types.js';

export function createAdapter(
  profile: AIProfile,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): AIProviderAdapter {
  switch (profile.provider) {
    case 'openai':
      return new OpenAIAdapter(profile, apiKey, fetchImpl);
    case 'anthropic':
      return new AnthropicAdapter(profile, apiKey, fetchImpl);
    default: {
      const _exhaustive: never = profile.provider;
      throw new Error(`unknown provider: ${String(_exhaustive)}`);
    }
  }
}
