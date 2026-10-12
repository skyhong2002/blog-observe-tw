import 'server-only';

/**
 * Private, per-request gateway reads. Always `no-store`: nothing read here is
 * shared between visitors or written to the ISR/fetch cache, and using it
 * makes the calling route dynamic. Public pages use public-api.ts instead.
 * The internal origin stays on the server; this module cannot be bundled
 * into client code.
 */
export function gatewayOrigin() {
  return process.env.BLOG_GATEWAY_INTERNAL_URL ?? 'http://127.0.0.1:18160';
}

export async function gateway<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${gatewayOrigin()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
