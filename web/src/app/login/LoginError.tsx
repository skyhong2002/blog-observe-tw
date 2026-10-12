'use client';

import { useSearchParams } from 'next/navigation';

/** The reason the gateway's /auth/google/callback sent the reader back here, if any. */
export default function LoginError() {
  const error = useSearchParams().get('error');
  if (!error) return null;
  return (
    <p role="status" className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">
      {error === 'cancelled' ? '你已取消 Google 登入，可以稍後再試。' : '登入未完成，請重新開始。'}
    </p>
  );
}
