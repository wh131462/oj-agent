/**
 * GBK 编解码工具。lazy import `iconv-lite`,避免在不需要时加载。
 */

type IconvLite = typeof import('iconv-lite');

let iconvPromise: Promise<IconvLite> | null = null;

async function getIconv(): Promise<IconvLite> {
  if (!iconvPromise) {
    iconvPromise = import('iconv-lite').then((m) => (m.default ?? m) as IconvLite);
  }
  return iconvPromise;
}

export type SupportedEncoding = 'utf-8' | 'gbk';

/** 解码字节到 UTF-16 字符串。 */
export async function decodeBody(
  bytes: ArrayBuffer | Uint8Array,
  encoding: SupportedEncoding,
): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (encoding === 'utf-8') {
    return new TextDecoder('utf-8').decode(buf);
  }
  const iconv = await getIconv();
  return iconv.decode(Buffer.from(buf), 'gbk');
}

/**
 * 把 form KV 序列化为 application/x-www-form-urlencoded body。
 *
 * `gbk` 时:每个值先用 iconv 编码为 GBK 字节序列,
 * 再对每个字节做 URL-encode(`%XX`);
 * 结果整体使用 `Content-Type: application/x-www-form-urlencoded; charset=gbk`。
 *
 * 抛 GBK 不可表示字符的检测:`iconv.encode` 在 strict 模式下对无法编码的字符
 * 返回 `?`(0x3F)。这里我们在编码后比对源/编码长度,若发现 `?` 字节
 * 来自原本非 `?` 字符,抛错让上层(适配器层)归一化为 `PLATFORM_ERROR`。
 */
export async function encodeForm(
  body: Record<string, string | number | boolean>,
  encoding: SupportedEncoding,
): Promise<string> {
  const parts: string[] = [];
  if (encoding === 'utf-8') {
    for (const [k, v] of Object.entries(body)) {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.join('&');
  }
  const iconv = await getIconv();
  for (const [k, v] of Object.entries(body)) {
    const valueStr = String(v);
    const buf = iconv.encode(valueStr, 'gbk');
    // 检测无法表示字符:GBK 中不存在的字符 iconv 默认用 '?' 替换。
    // 若原文已包含 '?' 则跳过,否则检测到 '?' 字节即视为不可编码。
    if (!valueStr.includes('?') && buf.includes(0x3f)) {
      throw new Error(`字符串包含 GBK 不支持的字符: ${valueStr}`);
    }
    parts.push(`${encodeURIComponent(k)}=${urlEncodeBytes(buf)}`);
  }
  return parts.join('&');
}

function urlEncodeBytes(buf: Buffer | Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    // 与 encodeURIComponent 一致的"unreserved"字符: A-Z a-z 0-9 - _ . ! ~ * ' ( )
    if (
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b === 0x2d ||
      b === 0x2e ||
      b === 0x5f ||
      b === 0x7e
    ) {
      s += String.fromCharCode(b);
    } else {
      s += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return s;
}
