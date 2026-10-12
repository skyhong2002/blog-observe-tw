'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { usePublicRefreshEpoch } from '@/lib/use-public-refresh';

// The public pages render per request, but a page the browser already holds
// (a tab left in the background, a bfcache restore, Next's router cache on
// back/forward) would keep showing what the gateway answered back then. When
// public-refresh.ts says so, re-render the current route on the server; the
// browser-side query reads follow the same signal in use-public-json.ts.
export default function PublicRefresh() {
  const router = useRouter();
  const epoch = usePublicRefreshEpoch();
  const seen = useRef(epoch);
  useEffect(() => {
    if (epoch === seen.current) return;
    seen.current = epoch;
    router.refresh();
  }, [epoch, router]);
  return null;
}
