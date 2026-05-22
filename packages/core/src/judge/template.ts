/**
 * 编译/运行命令模板渲染。
 *
 * 占位符:{src} {out} {dir} {main}
 *
 * 不实现完整 shell-quote;采用"如果值含 shell 危险字符则用单引号包裹并把单引号
 * 转义为 '\\'\\''"。值是文件路径在大多数 OS 下不应含 `'`,但保险起见处理。
 */

export interface RenderVars {
  src?: string;
  out?: string;
  dir?: string;
  main?: string;
}

export function renderTemplate(tmpl: string, vars: RenderVars): string {
  return tmpl.replace(/\{(src|out|dir|main)\}/g, (_, k: keyof RenderVars) => {
    const v = vars[k];
    if (v === undefined) {
      throw new Error(`renderTemplate: 缺失变量 {${k}}`);
    }
    return shellQuote(v);
  });
}

export function shellQuote(s: string): string {
  if (s === '') return "''";
  // 安全字符集合直接放过
  if (/^[A-Za-z0-9_./\-+=]+$/.test(s)) return s;
  // 单引号包裹,内部 ' 转 '\''
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}
