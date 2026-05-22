/**
 * 将 LeetCode CN `translatedContent` 的 HTML 转为轻量 Markdown。
 *
 * 规则:
 * - 段落 <p> -> 段落 + 空行
 * - <pre>/<code> -> fenced code block
 * - <ul>/<ol>/<li> -> Markdown 列表
 * - <strong>/<b> -> **bold**
 * - <em>/<i> -> *italic*
 * - <sup> -> ^{...}, <sub> -> _{...} (用于 KaTeX)
 * - <br> -> 换行
 * - 其他保留文本
 *
 * 不依赖 DOM,使用 cheerio(lazy import)。
 */

let cheerioPromise: Promise<typeof import('cheerio')> | null = null;

async function getCheerio() {
  if (!cheerioPromise) cheerioPromise = import('cheerio');
  return cheerioPromise;
}

export async function htmlToMarkdown(html: string): Promise<string> {
  if (!html || html.trim().length === 0) return '';
  const cheerio = await getCheerio();
  const $ = cheerio.load(`<root>${html}</root>`, { xml: false });

  const out: string[] = [];
  walk($('root')[0]!, $, out, 0);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function walk(node: any, $: any, out: string[], depth: number): void {
  if (!node) return;
  if (node.type === 'text') {
    out.push(decodeEntities(node.data ?? ''));
    return;
  }
  if (node.type !== 'tag' && node.type !== 'root' && node.name !== 'root') return;

  const tag = (node.name ?? '').toLowerCase();
  const children = node.children ?? [];

  const renderChildren = () => {
    for (const c of children) walk(c, $, out, depth);
  };

  switch (tag) {
    case 'root':
    case 'body':
    case 'html':
      renderChildren();
      return;
    case 'p':
    case 'div': {
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      const text = buf.join('').trim();
      if (text) {
        out.push(text);
        out.push('\n\n');
      }
      return;
    }
    case 'br':
      out.push('\n');
      return;
    case 'strong':
    case 'b':
      out.push('**');
      renderChildren();
      out.push('**');
      return;
    case 'em':
    case 'i':
      out.push('*');
      renderChildren();
      out.push('*');
      return;
    case 'code': {
      // 行内代码;若父节点是 pre,跳过(由 pre 统一处理)
      if (node.parent?.name === 'pre') {
        renderChildren();
        return;
      }
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      out.push('`' + buf.join('') + '`');
      return;
    }
    case 'pre': {
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      out.push('\n```\n');
      out.push(buf.join('').replace(/\n+$/, ''));
      out.push('\n```\n\n');
      return;
    }
    case 'sup': {
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      const t = buf.join('').trim();
      if (t) out.push(`^{${t}}`);
      return;
    }
    case 'sub': {
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      const t = buf.join('').trim();
      if (t) out.push(`_{${t}}`);
      return;
    }
    case 'ul':
    case 'ol': {
      out.push('\n');
      let idx = 1;
      for (const c of children) {
        if (c.type === 'tag' && (c.name === 'li' || c.name === 'LI')) {
          const buf: string[] = [];
          for (const cc of c.children ?? []) walk(cc, $, buf, depth + 1);
          const marker = tag === 'ol' ? `${idx++}.` : '-';
          out.push(`${marker} ${buf.join('').trim().replace(/\n+/g, ' ')}\n`);
        }
      }
      out.push('\n');
      return;
    }
    case 'li': {
      // 一般已由 ul/ol 处理;兜底
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      out.push(`- ${buf.join('').trim()}\n`);
      return;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1]);
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      out.push('\n' + '#'.repeat(level) + ' ' + buf.join('').trim() + '\n\n');
      return;
    }
    case 'img': {
      const src = node.attribs?.src ?? '';
      const alt = node.attribs?.alt ?? '';
      if (src) out.push(`![${alt}](${src})`);
      return;
    }
    case 'a': {
      const href = node.attribs?.href ?? '';
      const buf: string[] = [];
      for (const c of children) walk(c, $, buf, depth);
      const txt = buf.join('').trim();
      if (href) out.push(`[${txt}](${href})`);
      else out.push(txt);
      return;
    }
    case 'span':
    default:
      renderChildren();
      return;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
