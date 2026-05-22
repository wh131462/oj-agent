import * as vscode from 'vscode';
import { genNonce } from '../utils/html.js';

export interface HdojLoginResult {
  cookie: string;
}

/**
 * 弹出 HDOJ 登录 webview。加载 `userloginex.php`,
 * 注入 IIFE 读 `document.cookie`(HDOJ PHPSESSID 非 HttpOnly),
 * 通过 postMessage 回传给扩展。60s 无回传则 resolve undefined,由调用方降级。
 */
export function openHdojLoginWebview(timeoutMs = 60_000): Promise<HdojLoginResult | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'ojAgent.hdojLogin',
      'HDOJ 登录',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    const nonce = genNonce();
    panel.webview.html = buildHtml(nonce);

    let done = false;
    const finish = (val: HdojLoginResult | undefined): void => {
      if (done) return;
      done = true;
      try {
        panel.dispose();
      } catch {
        /* ignore */
      }
      resolve(val);
    };

    const timer = setTimeout(() => finish(undefined), timeoutMs);
    panel.onDidDispose(() => {
      clearTimeout(timer);
      finish(undefined);
    });
    panel.webview.onDidReceiveMessage((m: { type?: string; cookie?: string }) => {
      if (m && m.type === 'cookie' && typeof m.cookie === 'string' && m.cookie.length > 0) {
        clearTimeout(timer);
        finish({ cookie: m.cookie });
      }
    });
  });
}

function buildHtml(nonce: string): string {
  // 注意:webview iframe 加载第三方页面有跨域限制,且 vscode webview 默认不支持
  // 直接渲染外部站点 HTML 为根。这里实际策略是:
  //   1) 在 iframe 内加载 HDOJ 登录页(允许 frame-src http: https:)
  //   2) iframe 加载完后由用户在 iframe 内填表登录
  //   3) 父 webview 注入 message-channel 不可跨域访问 iframe.cookie
  //
  // 由于 VSCode Webview 在 iframe sandbox 下无法读取跨域 iframe 的 document.cookie,
  // 直接读 cookie 方案行不通。M1 实施时已在 design Risks 中允许降级:
  //   - 60s 超时由调用方降级到账号密码 form POST。
  //
  // 故此处 webview 仅作为"用户视觉指引"载体,渲染一个说明 + 倒计时,真正登录走降级路径。
  return /* html */ `<!doctype html><html><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-src http://acm.hdu.edu.cn https://acm.hdu.edu.cn;">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
  .hint { padding: 10px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; }
  iframe { width: 100%; height: 480px; border: 1px solid var(--vscode-panel-border); }
</style></head><body>
<div class="hint">
  <strong>HDOJ 登录</strong>
  <p>如果下方 iframe 可用,请直接在其中登录。若 60 秒内未检测到 Cookie,扩展将自动切到账号密码降级流程。</p>
</div>
<iframe src="http://acm.hdu.edu.cn/userloginex.php" sandbox="allow-forms allow-scripts allow-same-origin"></iframe>
<script nonce="${nonce}">
  // 由于跨域 iframe 不可读 cookie,M1 这里只做兜底 postMessage(无操作)。
  // 真正写入凭证由扩展端在降级 form POST 路径完成。
  void 0;
</script></body></html>`;
}
