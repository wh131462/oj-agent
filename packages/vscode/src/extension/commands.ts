import * as vscode from 'vscode';
import type { AIServices } from './services.js';
import type { OJServices } from './oj-services.js';
import { AIPanel } from './ai-panel.js';
import { SettingsPanel } from './settings-panel.js';
import type { AIAction, AIContextInput, ProblemDetail } from '@oj-agent/core';

/**
 * 题面 Webview / 测试结果面板尚未实现，这里先用 stub：
 * - 解题/解释类动作：从命令面板触发时，弹出一个简易输入框收集"题面 + 当前代码"以驱动流程。
 * - 后续 PRD M1 完成时，由真实视图调 invokeAIAction() 注入完整 ProblemDetail / FailedCase。
 */
async function getCurrentCode(): Promise<string | undefined> {
  const ed = vscode.window.activeTextEditor;
  return ed?.document.getText();
}

async function getSelection(): Promise<string | undefined> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return undefined;
  const sel = ed.document.getText(ed.selection);
  return sel.length > 0 ? sel : undefined;
}

async function promptProblemStub(): Promise<ProblemDetail | undefined> {
  const title = await vscode.window.showInputBox({ prompt: '题目标题（占位：M1 完成前由命令面板手动填）' });
  if (!title) return undefined;
  const statement = await vscode.window.showInputBox({
    prompt: '题面摘要（一行简述即可，正式版会从题面 Webview 自动注入）',
  });
  if (statement === undefined) return undefined;
  return {
    platform: 'manual',
    problemId: '',
    title,
    statement,
    samples: [],
  };
}

export interface InvokeOptions {
  problem: ProblemDetail;
  failedCase?: AIContextInput['failedCase'];
  code?: string;
  selection?: string;
}

export function invokeAIAction(
  ctx: vscode.ExtensionContext,
  services: AIServices,
  action: AIAction,
  opts: InvokeOptions,
): void {
  AIPanel.showWith(ctx, services, {
    action,
    problem: opts.problem,
    code: opts.code,
    selection: opts.selection,
    failedCase: opts.failedCase,
  });
}

async function runStubCommand(
  ctx: vscode.ExtensionContext,
  services: AIServices,
  action: AIAction,
): Promise<void> {
  const problem = await promptProblemStub();
  if (!problem) return;
  const code = await getCurrentCode();
  const selection = action.kind === 'explainCode' ? await getSelection() : undefined;
  invokeAIAction(ctx, services, action, { problem, code, selection });
}

async function switchProfile(services: AIServices): Promise<void> {
  const list = services.profiles.list();
  if (list.length === 0) {
    const pick = await vscode.window.showInformationMessage(
      '尚未配置任何 AI Profile',
      '打开 AI 设置',
    );
    if (pick) await vscode.commands.executeCommand('ojAgent.ai.openSettings');
    return;
  }
  const items = list.map((p) => ({ label: p.label, description: `${p.provider} · ${p.model}`, id: p.id }));
  const choice = await vscode.window.showQuickPick(items, { placeHolder: '选择活动 AI Profile' });
  if (!choice) return;
  await services.profiles.setActive(choice.id);
}

async function testConnection(services: AIServices): Promise<void> {
  const profile = services.profiles.getActive();
  if (!profile) {
    void vscode.window.showWarningMessage('请先选择活动 Profile');
    return;
  }
  const apiKey = await services.vault.get(profile.id);
  if (!apiKey) {
    void vscode.window.showErrorMessage(`Profile "${profile.label}" 未配置 API Key`);
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `测试 ${profile.label}...` },
    async () => {
      const start = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      let gotChunk = false;
      let errMsg = '';
      let httpStatus: number | undefined;
      try {
        for await (const c of services.runner.run({
          profile,
          apiKey,
          system: 'pong',
          user: 'ping',
          signal: ctl.signal,
          redactEnabled: true,
        })) {
          if (c.type === 'text') gotChunk = true;
          if (c.type === 'error') {
            errMsg = c.error?.message ?? 'error';
            httpStatus = c.error?.httpStatus;
            break;
          }
          if (c.type === 'done') break;
        }
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
      const ms = Date.now() - start;
      if (errMsg) {
        const code = httpStatus ? `HTTP ${httpStatus}` : '网络错误';
        void vscode.window.showErrorMessage(`连接失败（${code}）：${errMsg}`);
      } else if (gotChunk) {
        void vscode.window.showInformationMessage(`连接成功（耗时 ${ms} ms，流式正常）`);
      } else {
        void vscode.window.showWarningMessage(`连接成功，但未收到流式 chunk（耗时 ${ms} ms）`);
      }
    },
  );
}

async function pickProfileId(services: AIServices, prompt: string): Promise<string | undefined> {
  const list = services.profiles.list();
  if (list.length === 0) return undefined;
  const items = list.map((p) => ({ label: p.label, description: `${p.provider} · ${p.model}`, id: p.id }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: prompt });
  return pick?.id;
}

function resolveProfileIdArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object') {
    const obj = arg as { profileId?: unknown; id?: unknown };
    if (typeof obj.profileId === 'string') return obj.profileId;
    if (typeof obj.id === 'string') return obj.id;
  }
  return undefined;
}

export interface ProvidersBundle {
  profilesView: { refresh(): void };
}

export function registerCommands(
  ctx: vscode.ExtensionContext,
  services: AIServices,
  providers: ProvidersBundle,
  oj: OJServices,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.ai.explainError', () =>
      runStubCommand(ctx, services, { kind: 'explainError' }),
    ),
    vscode.commands.registerCommand('ojAgent.ai.generateApproach', () =>
      runStubCommand(ctx, services, { kind: 'generateApproach' }),
    ),
    vscode.commands.registerCommand('ojAgent.ai.generateSolution', () =>
      runStubCommand(ctx, services, { kind: 'generateSolution' }),
    ),
    vscode.commands.registerCommand('ojAgent.ai.explainCode', () =>
      runStubCommand(ctx, services, { kind: 'explainCode' }),
    ),
    vscode.commands.registerCommand('ojAgent.ai.switchProfile', async () => {
      await switchProfile(services);
      providers.profilesView.refresh();
    }),
    vscode.commands.registerCommand('ojAgent.ai.testConnection', () => testConnection(services)),
    vscode.commands.registerCommand('ojAgent.ai.openSettings', () => {
      SettingsPanel.show(ctx, services, oj);
    }),
    vscode.commands.registerCommand('ojAgent.ai.openPanel', () => {
      AIPanel.open(ctx, services);
    }),
    vscode.commands.registerCommand('ojAgent.ai.newConversation', () => {
      AIPanel.openNew(ctx, services);
    }),
    vscode.commands.registerCommand('ojAgent.ai.addProfile', () => {
      SettingsPanel.show(ctx, services, oj);
    }),
    vscode.commands.registerCommand('ojAgent.ai.refreshProfiles', () => {
      providers.profilesView.refresh();
    }),
    vscode.commands.registerCommand('ojAgent.ai.editProfile', (arg?: unknown) => {
      const _id = resolveProfileIdArg(arg);
      // 编辑入口统一打开 Settings 面板（其中包含编辑表单）。
      SettingsPanel.show(ctx, services, oj);
    }),
    vscode.commands.registerCommand('ojAgent.ai.editProfileInline', (arg?: unknown) => {
      const _id = resolveProfileIdArg(arg);
      SettingsPanel.show(ctx, services, oj);
    }),
    vscode.commands.registerCommand('ojAgent.ai.setActiveProfile', async (arg?: unknown) => {
      let id = resolveProfileIdArg(arg);
      if (!id) id = await pickProfileId(services, '选择活动 Profile');
      if (!id) return;
      await services.profiles.setActive(id);
      providers.profilesView.refresh();
      const p = services.profiles.getActive();
      if (p) void vscode.window.showInformationMessage(`已切换到 ${p.label}`);
    }),
    vscode.commands.registerCommand('ojAgent.ai.deleteProfile', async (arg?: unknown) => {
      let id = resolveProfileIdArg(arg);
      if (!id) id = await pickProfileId(services, '选择要删除的 Profile');
      if (!id) return;
      const target = services.profiles.list().find((p) => p.id === id);
      const confirm = await vscode.window.showWarningMessage(
        `确认删除 Profile "${target?.label ?? id}"？同时会清除其 API Key。`,
        { modal: true },
        '删除',
      );
      if (confirm !== '删除') return;
      await services.profiles.remove(id);
      await services.vault.delete(id);
      providers.profilesView.refresh();
    }),
  ];
}
