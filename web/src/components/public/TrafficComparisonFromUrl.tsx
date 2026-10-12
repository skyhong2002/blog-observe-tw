'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import BlogTrafficComparison from '@/components/BlogTrafficComparison';
import type { TrafficData } from '@/lib/traffic';

/**
 * /traffic/'s comparison table filled from the URL (sort, month, q, state,
 * view, page, compare). Sits inside a Suspense boundary whose fallback is the
 * same table with no query. The query is read once: the table writes its own
 * state back with history.replaceState, which must not remount it.
 */
export default function TrafficComparisonFromUrl({ data }: { data: TrafficData }) {
  const params = useSearchParams();
  const [initial] = useState(() => {
    // First value of each key, as the old server page read them.
    const query: Record<string, string | undefined> = {};
    for (const key of new Set(params.keys())) query[key] = params.get(key)?.slice(0, 300);
    return query;
  });
  return <BlogTrafficComparison data={data} initial={initial} />;
}
