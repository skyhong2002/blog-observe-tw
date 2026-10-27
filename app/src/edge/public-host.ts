import { readFile } from 'node:fs/promises';

export const PUBLIC_ORIGIN = 'https://weblog.tw';
export const LEGACY_HOST = 'blog.observe.tw';

/** Operator-owned switch, separate from the application release. Missing means no migration yet. */
export async function legacyRedirectEnabled(path: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).join(',') !== 'enabled' || typeof value.enabled !== 'boolean')
    throw Error('invalid_legacy_redirect_state');
  return value.enabled;
}

/** Raw Host only: forwarded headers cannot select a redirect or change its fixed destination. */
export function legacyHost(host: string | undefined): boolean {
  return /^blog\.observe\.tw(?::(?:80|443))?$/i.test(host ?? '');
}
