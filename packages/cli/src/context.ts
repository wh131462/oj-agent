/**
 * CLI 上下文:装配 core 引擎与 backend。
 * 命令通过 context 拿到所需服务,而不重复构造。
 */

import {
  HttpClient,
  PlatformAdapterRegistry,
  RateLimiter,
  SecretCredentialStore,
  SharedConfigStore,
  WorkspaceManager,
  JudgeRunner,
  SubmissionRunner,
  ToolchainProbe,
  CredentialChecker,
  type LoggerBackend,
} from '@oj-agent/core';
import {
  TomlConfigBackend,
  resolveConfigPath,
} from './backends/toml-config.js';
import { createSecretBackend, type SecretBackendInfo } from './backends/index.js';
import { TerminalLogger } from './logger/terminal-logger.js';
import type { GlobalOptions } from './utils/globals.js';

export interface CliContext {
  config: TomlConfigBackend;
  sharedConfigStore: SharedConfigStore;
  secretInfo: SecretBackendInfo;
  credentialStore: SecretCredentialStore;
  httpClient: HttpClient;
  registry: PlatformAdapterRegistry;
  workspace: WorkspaceManager;
  judge: JudgeRunner;
  submission: SubmissionRunner;
  toolchain: ToolchainProbe;
  credChecker: CredentialChecker;
  logger: LoggerBackend;
  globals: GlobalOptions;
  configPath: string;
}

export async function createContext(globals: GlobalOptions): Promise<CliContext> {
  const configPath = resolveConfigPath({ explicit: globals.config });
  const sharedConfigStore = new SharedConfigStore();
  const config = new TomlConfigBackend({ configPath, sharedConfigStore });
  await config.preloadAIConfig();
  const logger = new TerminalLogger(globals);
  const secretInfo = await createSecretBackend({ configPath });

  if (secretInfo.warning && !globals.quiet && !globals.json) {
    process.stderr.write('[oja] ' + secretInfo.warning + '\n');
  }

  const credentialStore = new SecretCredentialStore(secretInfo.backend, { sharedConfigStore });
  // 启动时同步从 SharedConfigStore 加载已有 session 到 SecretBackend
  await credentialStore.loadFromSharedStore();

  // 限速:按平台读取配置
  const rateLimiter = new RateLimiter((bucket) => {
    const key = `http.rateLimit.${bucket}`;
    return config.getWithDefault<number>(key, 60);
  });

  const proxyUrl = config.getWithDefault<string>('http.proxy', '') || undefined;

  const httpClient = new HttpClient({
    credentialStore,
    rateLimiter,
    proxyUrl,
  });

  const registry = new PlatformAdapterRegistry({
    httpClient,
    credentialStore,
    rateLimiter,
  });
  const workspace = new WorkspaceManager({ logger });
  const toolchain = new ToolchainProbe({ logger });
  const judge = new JudgeRunner({ logger, toolchain });
  const submission = new SubmissionRunner({ registry, credentialStore, logger });
  const credChecker = new CredentialChecker(httpClient);

  // CLI 是短生命周期：进程退出时释放 watcher
  const cleanup = (): void => { void sharedConfigStore.dispose(); };
  process.once('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });

  return {
    config,
    sharedConfigStore,
    secretInfo,
    credentialStore,
    httpClient,
    registry,
    workspace,
    judge,
    submission,
    toolchain,
    credChecker,
    logger,
    globals,
    configPath,
  };
}
