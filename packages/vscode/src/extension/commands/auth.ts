import * as vscode from 'vscode';
import {
  LoginFlow,
  platformLoginConfigs,
  type CredentialStore,
  type CredentialChecker,
  type HttpClient,
  type PlatformCredential,
  type PlatformId,
  type LoginConfig,
  type LoginResult,
} from '@oj-agent/core';
import type { OJServices } from '../oj-services.js';
import { openHdojLoginWebview } from '../views/auth-webview.js';
import { PlaywrightBrowserLogin } from '../backends/playwright-browser-login.js';

const HDOJ_LOGIN_URL = 'http://acm.hdu.edu.cn/userloginex.php?action=login';

async function loginHdojByForm(
  http: HttpClient,
  username: string,
  password: string,
): Promise<{ cookie: string } | undefined> {
  try {
    const res = await http.request({
      url: HDOJ_LOGIN_URL,
      method: 'POST',
      contentType: 'form',
      formEncoding: 'gbk',
      body: {
        username,
        userpass: password,
        login: 'Sign In',
      },
      headers: {
        Referer: 'http://acm.hdu.edu.cn/userloginex.php',
        Origin: 'http://acm.hdu.edu.cn',
      },
      responseEncoding: 'gbk',
      timeoutMs: 12_000,
    });
    const setCookie = res.headers['set-cookie'] ?? res.headers['Set-Cookie'];
    if (typeof setCookie === 'string' && /PHPSESSID=/.test(setCookie)) {
      const m = setCookie.match(/PHPSESSID=[^;]+/);
      if (m) return { cookie: m[0] };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function pickPlatform(): Promise<PlatformId | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'LeetCode CN', value: 'leetcode-cn' as PlatformId },
      { label: 'HDOJ', value: 'hdoj' as PlatformId },
    ],
    { placeHolder: '选择要登录的平台' },
  );
  return pick?.value;
}

/**
 * 浏览器自动登录(VSCode 端)。返回 'fallback' 表示需要降级到 manual。
 */
async function loginViaBrowser(
  config: LoginConfig,
  services: OJServices,
): Promise<'success' | 'fallback' | 'failed'> {
  const flow = new LoginFlow({
    capture: new PlaywrightBrowserLogin({
      onLaunched(info) {
        void vscode.window.showInformationMessage(
          `正在用 ${info.name} 打开登录页,请在浏览器内完成登录`,
        );
      },
    }),
    credentialStore: services.credentialStore,
    credChecker: services.credentialChecker,
  });

  let result: LoginResult | undefined;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `OJ-Agent: ${config.platform} 浏览器登录`,
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: '启动浏览器...' });
      token.onCancellationRequested(() => {
        void flow.cancel();
      });
      result = await flow.run(config);
    },
  );

  if (!result) return 'failed';
  if (result.ok) {
    const userPart = result.username ? `(${result.username})` : '';
    void vscode.window.showInformationMessage(`✓ ${config.platform} 登录成功${userPart}`);
    return 'success';
  }
  switch (result.reason) {
    case 'browser-not-found':
      void vscode.window.showWarningMessage(
        `未检测到可用浏览器,改为手动粘贴 Cookie:${result.message}`,
      );
      return 'fallback';
    case 'cancelled':
      void vscode.window.showInformationMessage('已取消登录');
      return 'failed';
    case 'timeout':
      void vscode.window.showErrorMessage(`登录超时:${result.message}`);
      return 'failed';
    case 'auth-invalid':
      void vscode.window.showErrorMessage(`Cookie 校验未通过:${result.message}`);
      return 'failed';
    case 'capture-failed':
    default:
      void vscode.window.showErrorMessage(`登录失败:${result.message}`);
      return 'failed';
  }
}

async function loginLeetCodeCnManual(
  store: CredentialStore,
  checker: CredentialChecker,
): Promise<boolean> {
  const session = await vscode.window.showInputBox({
    prompt: 'LeetCode CN: 输入 LEETCODE_SESSION',
    password: true,
    ignoreFocusOut: true,
  });
  if (!session) return false;
  const csrf = await vscode.window.showInputBox({
    prompt: 'LeetCode CN: 输入 csrftoken',
    ignoreFocusOut: true,
  });
  if (!csrf) return false;
  const cookie = `LEETCODE_SESSION=${session}; csrftoken=${csrf}`;
  const cred: PlatformCredential = {
    platform: 'leetcode-cn',
    cookie,
    extra: { csrftoken: csrf },
  };
  await store.set('leetcode-cn', cred);
  try {
    const status = await checker.check('leetcode-cn');
    if (status === 'valid') {
      void vscode.window.showInformationMessage('LeetCode CN 登录成功');
      return true;
    }
    void vscode.window.showWarningMessage(`LeetCode CN 登录态 = ${status},请确认 Cookie 正确`);
  } catch {
    /* ignore */
  }
  return true;
}

async function loginHdojManual(
  http: HttpClient,
  store: CredentialStore,
  checker: CredentialChecker,
): Promise<boolean> {
  void vscode.window.showInformationMessage(
    '正在打开 HDOJ 登录页;若 60 秒内未获取 Cookie,将切换到账号密码登录。',
  );
  const wv = await openHdojLoginWebview(60_000);
  if (wv?.cookie) {
    await store.set('hdoj', { platform: 'hdoj', cookie: wv.cookie });
    void vscode.window.showInformationMessage('HDOJ 登录成功');
    return true;
  }
  const username = await vscode.window.showInputBox({
    prompt: 'HDOJ 用户名',
    ignoreFocusOut: true,
  });
  if (!username) return false;
  const password = await vscode.window.showInputBox({
    prompt: 'HDOJ 密码',
    password: true,
    ignoreFocusOut: true,
  });
  if (!password) return false;
  const res = await loginHdojByForm(http, username, password);
  if (!res) {
    void vscode.window.showErrorMessage('HDOJ 登录失败:用户名/密码错误或网络异常');
    return false;
  }
  await store.set('hdoj', {
    platform: 'hdoj',
    cookie: res.cookie,
    extra: { username },
  });
  try {
    const status = await checker.check('hdoj');
    if (status === 'valid') {
      void vscode.window.showInformationMessage(`HDOJ 登录成功 (${username})`);
    } else {
      void vscode.window.showWarningMessage(`HDOJ 登录态 = ${status}`);
    }
  } catch {
    /* ignore */
  }
  return true;
}

async function loginManualByPlatform(platform: PlatformId, services: OJServices): Promise<boolean> {
  if (platform === 'leetcode-cn') {
    return loginLeetCodeCnManual(services.credentialStore, services.credentialChecker);
  }
  if (platform === 'hdoj') {
    return loginHdojManual(services.httpClient, services.credentialStore, services.credentialChecker);
  }
  void vscode.window.showWarningMessage(`平台 ${platform} 尚未支持登录(M2)`);
  return false;
}

async function loginAuto(platform: PlatformId, services: OJServices): Promise<boolean> {
  const config = platformLoginConfigs[platform];
  if (!config) {
    return loginManualByPlatform(platform, services);
  }
  const result = await loginViaBrowser(config, services);
  if (result === 'success') return true;
  if (result === 'fallback') return loginManualByPlatform(platform, services);
  return false;
}

function extractPlatformArg(arg: unknown): PlatformId | undefined {
  if (typeof arg === 'string') return arg as PlatformId;
  if (arg && typeof arg === 'object' && 'platform' in arg) {
    const p = (arg as { platform?: PlatformId }).platform;
    return p;
  }
  return undefined;
}

export function registerAuthCommands(services: OJServices): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.auth.login', async (arg?: unknown) => {
      let platform = extractPlatformArg(arg);
      if (!platform) platform = await pickPlatform();
      if (!platform) return;
      await loginAuto(platform, services);
    }),
    vscode.commands.registerCommand('ojAgent.auth.loginManual', async (arg?: unknown) => {
      let platform = extractPlatformArg(arg);
      if (!platform) platform = await pickPlatform();
      if (!platform) return;
      await loginManualByPlatform(platform, services);
    }),
    vscode.commands.registerCommand('ojAgent.auth.logout', async (arg?: unknown) => {
      let platform = extractPlatformArg(arg);
      if (!platform) platform = await pickPlatform();
      if (!platform) return;
      // 确认对话框 — 防止从 QuickPick 误触
      const cred = await services.credentialStore.get(platform);
      const userPart = cred?.extra?.username ? `(${cred.extra.username})` : '';
      const confirm = await vscode.window.showWarningMessage(
        `确认登出 ${platform}${userPart}?`,
        { modal: true },
        '登出',
      );
      if (confirm !== '登出') return;
      await services.credentialStore.delete(platform);
      void vscode.window.showInformationMessage(`${platform} 已登出`);
    }),
    vscode.commands.registerCommand('ojAgent.auth.relogin', async (arg?: unknown) => {
      // relogin 跳过 logout 命令的确认对话框,直接 delete + login
      let platform = extractPlatformArg(arg);
      if (!platform) platform = await pickPlatform();
      if (!platform) return;
      await services.credentialStore.delete(platform);
      await vscode.commands.executeCommand('ojAgent.auth.login', platform);
    }),
    vscode.commands.registerCommand('ojAgent.auth.openCookieGuide', () => {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/wh131462/oj-agent#cookie-guide'),
      );
    }),
  ];
}
