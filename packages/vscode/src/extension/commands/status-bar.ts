import * as vscode from 'vscode';

export function registerStatusBarCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ojAgent.statusBar.openQuickPick', async () => {
      const items: Array<vscode.QuickPickItem & { cmd: string }> = [
        { label: '$(sign-in) 登录平台', cmd: 'ojAgent.auth.login' },
        { label: '$(sign-out) 登出平台', cmd: 'ojAgent.auth.logout' },
        { label: '$(refresh) 重新登录', cmd: 'ojAgent.auth.relogin' },
        { label: '$(folder) 设置工作区根目录', cmd: 'ojAgent.workspace.setRoot' },
        { label: '$(output) 打开 OutputChannel', cmd: 'ojAgent.openOutputChannel' },
        { label: '$(tools) 查看工具链状态', cmd: 'ojAgent.judge.openToolchain' },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择动作' });
      if (!pick) return;
      await vscode.commands.executeCommand(pick.cmd);
    }),
  ];
}
