import * as vscode from 'vscode';

export function registerStatusBarCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.statusBar.openQuickPick', async () => {
      // 把登出 / 重新登录放到底部"危险区",中间用分隔符隔开,避免误触
      const items: Array<vscode.QuickPickItem & { cmd?: string }> = [
        { label: '$(sign-in) 登录平台(浏览器自动)', cmd: 'ojAgent.auth.login' },
        { label: '$(key) 登录平台(手动粘贴 Cookie)', cmd: 'ojAgent.auth.loginManual' },
        { label: '$(folder) 设置工作区根目录', cmd: 'ojAgent.workspace.setRoot' },
        { label: '$(output) 打开 OutputChannel', cmd: 'ojAgent.openOutputChannel' },
        { label: '$(tools) 查看工具链状态', cmd: 'ojAgent.judge.openToolchain' },
        { label: '账号管理', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(refresh) 重新登录', cmd: 'ojAgent.auth.relogin' },
        { label: '$(sign-out) 登出平台', cmd: 'ojAgent.auth.logout' },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择动作' });
      if (!pick || !pick.cmd) return;
      await vscode.commands.executeCommand(pick.cmd);
    }),
  ];
}
