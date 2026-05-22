import { escapeHtml } from '../utils/html.js';

/**
 * 把 markdown 文本渲染为 HTML(含 KaTeX 公式)。
 * 任意失败均降级为 `<pre>` 纯文本,不抛错。
 *
 * 采用 lazy import 减小启动开销:首次调用时才加载 markdown-it / katex。
 */
let mdInstance: { render: (src: string) => string } | null = null;
let initialized = false;

async function getMd(): Promise<{ render: (src: string) => string } | null> {
  if (initialized) return mdInstance;
  initialized = true;
  try {
    const mdMod = await import('markdown-it');
    const Md = (mdMod as { default?: unknown }).default ?? mdMod;
    const katexMod = await import('katex');
    const katex = (katexMod as { default?: unknown }).default ?? katexMod;
    const texmathMod = await import('markdown-it-texmath');
    const texmath = (texmathMod as { default?: unknown }).default ?? texmathMod;

    // markdown-it 默认导出是构造函数
    const md = new (Md as new (opts: Record<string, unknown>) => {
      use: (plugin: unknown, opts?: unknown) => unknown;
      render: (src: string) => string;
    })({
      html: true,
      linkify: true,
      breaks: false,
    });
    md.use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false } });
    mdInstance = { render: (src) => md.render(src) };
  } catch {
    mdInstance = null;
  }
  return mdInstance;
}

export async function renderMarkdown(src: string): Promise<string> {
  try {
    const md = await getMd();
    if (md) return md.render(src);
  } catch {
    /* fallthrough */
  }
  return `<pre>${escapeHtml(src)}</pre>`;
}
