'use client';

import { useEffect, useState } from 'react';

// Who is signed in, from the gateway's /auth/me (app/src/auth/google-login.ts).
// Pages stay static and cacheable; the browser asks once per page load.
export type SessionUser = { id: number; email: string; name: string | null; picture: string | null; role: 'admin' | 'reader' };
export type Session = { enabled: boolean; user: SessionUser | null };

let pending: Promise<Session> | null = null;

export function loadSession(): Promise<Session> {
  pending ??= fetch('/auth/me', { cache: 'no-store', credentials: 'same-origin' })
    .then(async (response): Promise<Session> => {
      if (!response.ok) return { enabled: false, user: null };
      const session = (await response.json()) as Session;
      if (session.user) {
        const capabilities = await fetch('/api/me/capabilities', { cache: 'no-store', credentials: 'same-origin' })
          .then(async (result) => (result.ok ? ((await result.json()) as { admin?: boolean }) : { admin: false }))
          .catch(() => ({ admin: false }));
        session.user.role = capabilities.admin === true ? 'admin' : 'reader';
      }
      return session;
    })
    .catch(() => ({ enabled: false, user: null }));
  return pending;
}

/** null while loading. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let live = true;
    loadSession().then((value) => live && setSession(value));
    return () => {
      live = false;
    };
  }, []);
  return session;
}

export function loginHref(next: string) {
  return `/auth/google?next=${encodeURIComponent(next)}`;
}
