import * as vscode from 'vscode';
import {
  SecretCredentialStore,
  CredentialChecker,
  RateLimiter,
  HttpClient,
  PlatformAdapterRegistry,
  WorkspaceManager,
  JudgeRunner,
  SubmissionRunner,
  ToolchainProbe,
  type CredentialStore,
  type LoggerBackend,
  type PlatformId,
} from '@oj-agent/core';
import { VSCodeSecretBackend } from './backends/vscode-secret.js';
import { VSCodeConfigBackend } from './backends/vscode-config.js';
import { VSCodeOutputChannelLogger } from './backends/vscode-output-channel-logger.js';
import { SharedConfigStore } from '@oj-agent/core';

export interface OJServices {
  logger: VSCodeOutputChannelLogger;
  loggerBackend: LoggerBackend;
  secretBackend: VSCodeSecretBackend;
  configBackend: VSCodeConfigBackend;
  credentialStore: CredentialStore;
  credentialChecker: CredentialChecker;
  rateLimiter: RateLimiter;
  httpClient: HttpClient;
  registry: PlatformAdapterRegistry;
  workspaceManager: WorkspaceManager;
  toolchainProbe: ToolchainProbe;
  judgeRunner: JudgeRunner;
  submissionRunner: SubmissionRunner;
}

/**
 * 按 design D5 顺序构造 OJ 端服务链:
 *   logger → secretBackend → configBackend → credentialStore → rateLimiter
 *   → httpClient → registry → workspaceManager → judgeRunner → submissionRunner
 */
export function buildOJServices(ctx: vscode.ExtensionContext): OJServices {
  const logger = new VSCodeOutputChannelLogger('OJ-Agent');
  ctx.subscriptions.push({ dispose: () => logger.dispose() });

  const loggerBackend: LoggerBackend = {
    info(scope, msg, extra) {
      logger.info(scope, msg, extra);
    },
    warn(scope, msg, extra) {
      logger.warn(scope, msg, extra);
    },
    error(scope, msg, err) {
      logger.error(scope, msg, err);
    },
  };

  // 任务 5.1: 先实例化 SharedConfigStore
  const sharedConfigStore = new SharedConfigStore();
  ctx.subscriptions.push({ dispose: () => void sharedConfigStore.dispose() });

  // 任务 4.4: 注册 SharedConfigStore onChange，文件变更时通知 VSCode 侧
  ctx.subscriptions.push(
    sharedConfigStore.watch((event) => {
      if (event.type === 'session') {
        void vscode.commands.executeCommand('ojAgent.internal.refreshCredentials');
      }
    }),
  );

  const secretBackend = new VSCodeSecretBackend(ctx.secrets, sharedConfigStore);
  const configBackend = new VSCodeConfigBackend('ojAgent', { sharedConfigStore });

  const credentialStore = new SecretCredentialStore(secretBackend, { sharedConfigStore });

  const rateLimiter = new RateLimiter((bucket: string) => {
    const v = configBackend.get<number>(`http.rateLimit.${bucket}`);
    if (typeof v === 'number' && v > 0) return v;
    // 默认值
    if (bucket === 'leetcode-cn') return 30;
    if (bucket === 'hdoj') return 60;
    return 30;
  });

  const proxyUrl = configBackend.get<string>('http.proxy');
  const httpClient = new HttpClient({
    credentialStore,
    rateLimiter,
    proxyUrl: proxyUrl && proxyUrl.length > 0 ? proxyUrl : undefined,
  });

  const credentialChecker = new CredentialChecker(httpClient);

  const registry = new PlatformAdapterRegistry({
    httpClient,
    credentialStore,
    rateLimiter,
  });

  const workspaceManager = new WorkspaceManager({ logger: loggerBackend });

  const toolchainProbe = new ToolchainProbe({ logger: loggerBackend });
  const judgeRunner = new JudgeRunner({ logger: loggerBackend, toolchain: toolchainProbe });

  const submissionRunner = new SubmissionRunner({
    registry,
    credentialStore,
    logger: loggerBackend,
  });

  return {
    logger,
    loggerBackend,
    secretBackend,
    configBackend,
    credentialStore,
    credentialChecker,
    rateLimiter,
    httpClient,
    registry,
    workspaceManager,
    toolchainProbe,
    judgeRunner,
    submissionRunner,
  };
}

/** 读取工作区根目录;空字符串 → ${HOME}/oj-agent-workspace。 */
export function resolveWorkspaceRoot(cfg: VSCodeConfigBackend): string {
  const raw = cfg.get<string>('workspace.root');
  if (raw && raw.trim().length > 0) return raw;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/oj-agent-workspace`;
}

/** 列出当前启用平台,空数组允许返回(等同于隐藏 OJ UI)。 */
export function getEnabledPlatforms(cfg: VSCodeConfigBackend): PlatformId[] {
  const list = cfg.get<string[]>('platforms.enabled') ?? ['leetcode-cn', 'hdoj'];
  return list.filter((p): p is PlatformId =>
    p === 'leetcode-cn' || p === 'hdoj' || p === 'codeforces' || p === 'luogu' || p === 'poj' || p === 'lanqiao',
  );
}
