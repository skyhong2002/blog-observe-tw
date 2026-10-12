// Reader API keys, managed through the gateway's /auth/me/api-keys. Only
// metadata (label, prefix, times) is ever listed; the plaintext key exists
// once, in the create response, and lives only in component state.

export interface ApiKeyMeta {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface ApiKeyList {
  keys: ApiKeyMeta[];
  max: number;
  csrfToken: string;
}

export const API_KEYS_PATH = '/auth/me/api-keys';

/** Thrown for any non-2xx answer; 401 means the session is gone. */
export class ApiKeyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A page-lifetime fence: `end()` (on pagehide / unmount) makes every request
 * started before it stale, so a late answer, a new key's plaintext above all,
 * is never written to state after the reader left.
 */
export function createFence() {
  let generation = 0;
  return {
    end() {
      generation++;
    },
    /** Resolves `{ live: false }` when the fence ended while `promise` was pending; errors only surface while live. */
    async settle<T>(promise: Promise<T>): Promise<{ live: true; value: T } | { live: false }> {
      const started = generation;
      try {
        const value = await promise;
        return started === generation ? { live: true, value } : { live: false };
      } catch (error) {
        if (started !== generation) return { live: false };
        throw error;
      }
    },
  };
}

const CJK = /[㐀-鿿]/;

/** A short Chinese message for an API error: the gateway's own wording when it is Chinese, else one by status. */
export function errorMessage(status: number, body: unknown): string {
  const b = body as { message?: unknown; error?: unknown } | null;
  for (const text of [b?.message, b?.error]) if (typeof text === 'string' && CJK.test(text) && text.length <= 120) return text;
  if (status === 400) return '輸入內容不正確，請檢查名稱後再試。';
  if (status === 401) return '登入已過期，請重新登入。';
  if (status === 403) return '請求未通過驗證，請重新整理頁面後再試。';
  if (status === 404) return '找不到這把金鑰，可能已經撤銷。';
  if (status === 409) return '已達金鑰數量上限，請先撤銷不用的金鑰。';
  if (status === 429) return '操作太頻繁，請稍後再試。';
  if (status >= 500) return '伺服器暫時無法處理，請稍後再試。';
  return `請求失敗（HTTP ${status}），請稍後再試。`;
}

export function parseKeys(value: unknown): ApiKeyMeta[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((k) => k && typeof k.id !== 'undefined' && typeof k.prefix === 'string')
    .map((k) => ({
      id: String(k.id),
      label: typeof k.label === 'string' ? k.label : '',
      prefix: k.prefix,
      createdAt: typeof k.createdAt === 'string' ? k.createdAt : '',
      lastUsedAt: typeof k.lastUsedAt === 'string' ? k.lastUsedAt : null,
    }));
}

async function request(init: RequestInit & { path?: string } = {}): Promise<Response> {
  const { path = API_KEYS_PATH, ...rest } = init;
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...rest });
  if (!response.ok) throw new ApiKeyError(response.status, errorMessage(response.status, await response.json().catch(() => null)));
  return response;
}

export async function listKeys(signal?: AbortSignal): Promise<ApiKeyList> {
  const data = (await (await request({ signal })).json()) as Partial<ApiKeyList>;
  const keys = parseKeys(data.keys);
  if (!keys || typeof data.csrfToken !== 'string') throw new ApiKeyError(502, '金鑰清單格式無法辨識，請稍後再試。');
  return { keys, max: typeof data.max === 'number' ? data.max : 3, csrfToken: data.csrfToken };
}

export async function createKey(label: string, csrfToken: string): Promise<{ key: string; keys: ApiKeyMeta[]; max: number }> {
  const data = (await (
    await request({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-blog-csrf': csrfToken },
      body: JSON.stringify({ label }),
    })
  ).json()) as { key?: unknown; keys?: unknown; max?: unknown };
  const keys = parseKeys(data.keys);
  if (typeof data.key !== 'string' || !keys) throw new ApiKeyError(502, '金鑰已建立但回應格式無法辨識，請撤銷後重新建立。');
  return { key: data.key, keys, max: typeof data.max === 'number' ? data.max : 3 };
}

export async function revokeKey(id: string, csrfToken: string): Promise<void> {
  await request({ path: `${API_KEYS_PATH}/${encodeURIComponent(id)}`, method: 'DELETE', headers: { 'x-blog-csrf': csrfToken } });
}
