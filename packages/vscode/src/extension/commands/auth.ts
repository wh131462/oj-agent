import * as vscode from 'vscode';
import type {
  CredentialStore,
  HttpClient,
  PlatformCredential,
  PlatformId,
  CredentialChecker,
} from '@oj-agent/core';
import type { OJServices } from '../oj-services.js';
import { openHdojLoginWebview } from '../views/auth-webview.js';

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
    // HDOJ 登录成功:set-cookie 含 PHPSESSID,且返回 200/302
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

async function loginLeetCodeCn(store: CredentialStore, checker: CredentialChecker): Promise<boolean> {
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
  // 校验
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

async function loginHdoj(
  http: HttpClient,
  store: CredentialStore,
  checker: CredentialChecker,
): Promise<boolean> {
  // 6.2 阶段 1: 尝试 webview(已知有跨域限制,但保留入口供未来扩展)
  void vscode.window.showInformationMessage('正在打开 HDOJ 登录页;若 60 秒内未获取 Cookie,将切换到账号密码登录。');
  const wv = await openHdojLoginWebview(60_000);
  if (wv?.cookie) {
    await store.set('hdoj', { platform: 'hdoj', cookie: wv.cookie });
    void vscode.window.showInformationMessage('HDOJ 登录成功');
    return true;
  }
  // 阶段 2: 降级到账号密码 form POST
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
  // 校验
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

export function registerAuthCommands(services: OJServices): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.auth.login', async (arg?: { platform?: PlatformId } | PlatformId) => {
      let platform: PlatformId | undefined;
      if (typeof arg === 'string') platform = arg;
      else if (arg && typeof arg === 'object' && arg.platform) platform = arg.platform;
      if (!platform) platform = await pickPlatform();
      if (!platform) return;
      if (platform === 'leetcode-cn') {
        await loginLeetCodeCn(services.credentialStore, services.credentialChecker);
      } else if (platform === 'hdoj') {
        await loginHdoj(services.httpClient, services.credentialStore, services.credentialChecker);
      } else {
        void vscode.window.showWarningMessage(`平台 ${platform} 尚未支持登录(M2)`);
      }
    }),
    vscode.commands.registerCommand('ojAgent.auth.logout', async (arg?: { platform?: PlatformId } | PlatformId) => {
      let platform: PlatformId | undefined;
      if (typeof arg === 'string') platform = arg;
      else if (arg && typeof arg === 'object' && arg.platform) platform = arg.platform;
      if (!platform) platform = await pickPlatform();
      if (!platform) return;
      await services.credentialStore.delete(platform);
      void vscode.window.showInformationMessage(`${platform} 已登出`);
    }),
    vscode.commands.registerCommand('ojAgent.auth.relogin', async (arg?: { platform?: PlatformId } | PlatformId) => {
      await vscode.commands.executeCommand('ojAgent.auth.logout', arg);
      await vscode.commands.executeCommand('ojAgent.auth.login', arg);
    }),
    vscode.commands.registerCommand('ojAgent.auth.openCookieGuide', () => {
      void vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/wh131462/oj-agent#cookie-guide'),
      );
    }),
  ];
}
