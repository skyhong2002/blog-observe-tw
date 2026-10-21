import { Suspense } from 'react';
import RelationMapView, { RelationMapFromUrl } from '@/components/public/RelationMap';
import { publicJson } from '@/lib/public-api';
import { RELATIONS_PERIOD, relationsApiPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import type { Relations } from '@/lib/relations';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): the server page is the 7-day map (the 90-day one is too
// heavy for this host to be every visitor's first read); ?days=30|90 are read in the browser from the same public
// /api/relations. A 7-day read that fails or times out on the server (the shared host is often slow) does not fail
// the page: the browser reads it again itself, and the view says so with a retry only if that fails too.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/relations/');

export default async function Page() {
  const baseline = await publicJson<Relations>(relationsApiPath(RELATIONS_PERIOD)).catch((error: unknown) => {
    if (error instanceof PublicGatewayError) return null;
    throw error;
  });
  const load = baseline ? ({ status: 'ready', data: baseline } as const) : ({ status: 'pending' } as const);
  return (
    <Suspense fallback={<RelationMapView days={RELATIONS_PERIOD} load={load} />}>
      <RelationMapFromUrl baseline={baseline} />
    </Suspense>
  );
}
