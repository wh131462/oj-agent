/**
 * @oj-agent/core public API.
 *
 * Platform-agnostic. No VSCode / Node-specific runtime assumptions
 * beyond the standard Node 18+ runtime.
 */

// AI: types
export type {
  AIProvider,
  AIProfile,
  AIMessageRole,
  AIMessage,
  AIChunkType,
  AIChunk,
  AIRequestOptions,
  AIProviderAdapter,
} from './ai/types.js';
export { RateLimitError } from './ai/types.js';

// AI: profile & secret stores
export type { ConfigBackend } from './ai/profile-store.js';
export { ProfileStore } from './ai/profile-store.js';
export type { SecretBackend } from './ai/api-key-vault.js';
export { ApiKeyVault, AI_KEY_PREFIX } from './ai/api-key-vault.js';

// AI: adapters & factory
export { createAdapter } from './ai/factory.js';
export { OpenAIAdapter } from './ai/openai-adapter.js';
export { AnthropicAdapter } from './ai/anthropic-adapter.js';

// AI: runner & context
export { AIRunner } from './ai/runner.js';
export type { AIRunInput } from './ai/runner.js';
export {
  buildContext,
} from './ai/context-builder.js';
export type {
  SampleCase,
  FailedCase,
  ProblemDetail,
  AIAction,
  AIContextInput,
  BuiltContext,
} from './ai/context-builder.js';

// AI: utilities
export { redact, redactString } from './ai/redactor.js';
export {
  tokenEstimate,
  truncate,
} from './ai/truncate.js';
export type { TruncatableContext, TruncatedResult } from './ai/truncate.js';
export {
  parseSSEStream,
  safeJSONParse,
  errorChunk,
} from './ai/sse.js';
export {
  kebab,
  generateUniqueId,
  normalizeBaseUrl,
  looksLikeApiKey,
  validateProfile,
} from './ai/profile-utils.js';
export type { ProfileValidation } from './ai/profile-utils.js';

// HTTP
export { RateLimiter } from './http/rate-limiter.js';
export { HttpClient } from './http/client.js';
export type {
  HttpRequest,
  HttpResponse,
  HttpMethod,
  HttpClientOptions,
  CredentialReader,
} from './http/client.js';
export { encodeForm, decodeBody } from './http/encoding.js';
export type { SupportedEncoding } from './http/encoding.js';

// Auth: credential store
export {
  SecretCredentialStore,
  OJ_COOKIE_PREFIX,
} from './auth/credential-store.js';
export type {
  CredentialStore,
  CredentialChangeListener,
  Disposable,
} from './auth/credential-store.js';
export { CredentialChecker } from './auth/credential-checker.js';
export type { CredentialStatus } from './auth/credential-checker.js';

// Auth: browser-auto-login
export {
  BrowserNotFoundError,
  BrowserLoginCancelledError,
  BrowserLoginTimeoutError,
} from './auth/browser-login.js';
export type {
  BrowserLoginCapture,
  LoginConfig,
  CapturedAuth,
  BrowserPageHandle,
} from './auth/browser-login.js';
export { LoginFlow } from './auth/login-flow.js';
export type { LoginResult, LoginFailureReason, LoginFlowDeps } from './auth/login-flow.js';
export { platformLoginConfigs } from './auth/platform-login-configs.js';

// Platform adapter contracts (type-only placeholders for future implementations)
export type {
  PlatformId,
  PlatformCredential,
  PlatformProblemSummary,
  PlatformSampleCase,
  PlatformProblemDetail,
  PlatformListQuery,
  PlatformSubmissionId,
  PlatformVerdict,
  PlatformJudgeResult,
  PlatformAdapter,
} from './platform/adapter.js';

// Platform: errors & registry & adapters
export { AdapterError, fromHttpStatus } from './platform/errors.js';
export type { AdapterErrorCode } from './platform/errors.js';
export { PlatformAdapterRegistry } from './platform/registry.js';
export type { RegistryDeps } from './platform/registry.js';
export { LeetCodeCnAdapter } from './platform/leetcode-cn/index.js';
export { HDOJAdapter } from './platform/hdoj/index.js';

// Logger
export { NoopLogger } from './logger/logger.js';
export type { LoggerBackend, LoggerScope } from './logger/logger.js';

// Workspace
export { WorkspaceManager, LANG_EXT as WORKSPACE_LANG_EXT } from './workspace/workspace-manager.js';
export type {
  WorkspaceMeta,
  DefaultLang,
  WriteProblemOptions,
  WriteProblemResult,
} from './workspace/workspace-manager.js';
export { normalizeSlug } from './workspace/slug.js';

// Judge
export { ToolchainProbe } from './judge/toolchain.js';
export type { ToolInfo, ToolchainSnapshot } from './judge/toolchain.js';
export { JudgeRunner } from './judge/runner.js';
export type {
  JudgeLang,
  JudgeVerdict,
  JudgeCaseInput,
  JudgeCaseResult,
  JudgeRunOptions,
  JudgeRunResult,
} from './judge/runner.js';
export { normalize as normalizeOutput, firstDiff, unifiedDiff } from './judge/normalize.js';
export { renderTemplate, shellQuote } from './judge/template.js';
export { computeBuildHash, getBuildDir } from './judge/cache.js';

// Submission
export { SubmissionRunner } from './submission/runner.js';
export type {
  SubmissionRunInput,
  SubmissionRunnerDeps,
  SubmissionProgress,
} from './submission/runner.js';
