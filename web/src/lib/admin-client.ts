export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(adminErrorMessage(status, code));
    this.status = status;
    this.code = code;
  }
}
export function adminErrorMessage(status: number, code = '') {
  if (status === 401) return '登入已失效，請重新登入管理員帳號。';
  if (status === 403) return code === 'csrf_required' ? '驗證資訊已失效，請重新整理此頁後再操作。' : '此帳號沒有管理權限，或權限已被撤銷。';
  if (code === 'intent_uncertain' || code === 'intent_finalization_uncertain')
    return '操作結果尚未確認，請先查閱稽核與來源狀態；確認後再建立新操作，勿直接重送。';
  if (status === 409)
    return code === 'intent_pending'
      ? '前次操作仍在處理，請稍後以相同內容重試。'
      : code === 'similarweb_disabled'
        ? 'Similarweb 提交尚未啟用。'
        : '操作內容與先前紀錄衝突，請重新載入確認。';
  if (status === 429) return '已達操作或來源請求上限，請稍後再試。';
  if (status === 400) return '欄位未通過驗證，請檢查輸入內容。';
  return '操作暫時無法完成；請先查看結果或稽核紀錄，再以相同內容重試。';
}
export async function adminGet<T>(path: string, request: typeof fetch = fetch): Promise<T> {
  const response = await request(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  return read<T>(response);
}
async function read<T>(response: Response): Promise<T> {
  const value: unknown = await response.json().catch(() => null);
  const error = value && typeof value === 'object' && 'error' in value ? String(value.error) : '';
  if (!response.ok || error) throw new AdminApiError(response.ok ? 500 : response.status, error);
  return value as T;
}
/** Retain the intent key after an uncertain result: repeating the same operator action cannot duplicate writes. */
export class AdminWriter {
  private intent: { payload: string; key: string } | null = null;
  private busy = false;
  async post<T>(path: string, body: unknown, csrf: string, request: typeof fetch = fetch): Promise<T> {
    if (!/^\/api\/admin\/(?:discovery\/review|ai-override|tags|relations|similarweb)$/.test(path))
      throw new AdminApiError(400, 'invalid_admin_path');
    if (this.busy) throw new AdminApiError(409, 'intent_pending');
    if (!csrf) throw new AdminApiError(403, 'csrf_required');
    const payload = JSON.stringify([path, body]);
    if (this.intent?.payload !== payload) this.intent = { payload, key: crypto.randomUUID() };
    this.busy = true;
    try {
      const response = await request(path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-blog-csrf': csrf, 'idempotency-key': this.intent.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150000),
      });
      const result = await read<T>(response);
      this.intent = null;
      return result;
    } finally {
      this.busy = false;
    }
  }
}
export function safeAdminLink(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function manualOverride(bio: string, topicsText: string) {
  const topics = [
    ...new Set(
      topicsText
        .split(/\n|,|，/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  if (bio.length > 600 || topics.length > 8 || topics.some((t) => t.length > 60))
    throw Error('簡介最多 600 字；主題最多 8 個，每個最多 60 字。');
  return { classification: 'uncertain', confidence: 0, quotedEvidence: [], bio, topics };
}
