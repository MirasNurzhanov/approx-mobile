/** Errors may be rendered/logged by any caller. Never propagate Axios' request,
 * config, headers, native error text or original stack (all can hold secrets). */
export function safeApiError(source: unknown): Error {
  const error = source as {
    isAxiosError?: boolean; code?: string; __CANCEL__?: boolean;
    config?: { headers?: unknown; data?: unknown };
    response?: { status?: number; data?: unknown };
  } | null;
  const secrets = new Set<string>();
  const sensitive = /password|token|authorization|cookie|secret|^access$|^refresh$/i;
  function collect(value: unknown, key = '', depth = 0) {
    if (depth > 8) return;
    if (typeof value === 'string') {
      if (sensitive.test(key)) {
        secrets.add(value);
        if (/^Bearer /i.test(value)) secrets.add(value.slice(7));
      }
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([name, child]) => collect(child, name, depth + 1));
    }
  }
  collect(error?.config?.headers);
  let body = error?.config?.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  collect(body);
  collect(error?.response?.data);
  function clean(value: unknown, depth = 0): unknown {
    if (depth > 8) return '[redacted]';
    if (typeof value === 'string') {
      let text = value;
      for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
      return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
    }
    if (Array.isArray(value)) return value.map(child => clean(child, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sensitive.test(key) ? '[redacted]' : clean(child, depth + 1)]),
    );
    return value;
  }
  const status = error?.response?.status;
  const result = new Error(typeof status === 'number' ? `Request failed (${status}).` : 'Request could not be completed.');
  return Object.assign(result, {
    isAxiosError: error?.isAxiosError === true,
    code: typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : undefined,
    __CANCEL__: error?.__CANCEL__ === true,
    response: typeof status === 'number' ? { status, data: clean(error?.response?.data) } : undefined,
  });
}
