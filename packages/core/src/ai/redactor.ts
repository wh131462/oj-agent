const SENSITIVE_KEYS = new Set([
  'username',
  'user',
  'userid',
  'user_id',
  'uid',
  'submissionid',
  'submission_id',
  'cookie',
  'cookies',
  'authorization',
  'auth',
  'token',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'sessionid',
  'session_id',
  'csrf',
  'csrftoken',
  'csrf_token',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) continue;
    out[k] = redact(v);
  }
  return out as unknown as T;
}

/** 对字符串进行模式脱敏：移除 Cookie/Authorization 形态的子串。 */
export function redactString(s: string): string {
  return s
    .replace(/Cookie:\s*[^\n]*/gi, 'Cookie: <redacted>')
    .replace(/Authorization:\s*[^\n]*/gi, 'Authorization: <redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer <redacted>');
}
