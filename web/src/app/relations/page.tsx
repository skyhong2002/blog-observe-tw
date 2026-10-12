import { Suspense } from 'react';
import RelationMapView, { RelationMapFromUrl } from '@/components/public/RelationMap';
import { publicJson } from '@/lib/public-api';
import { RELATIONS_PERIOD, relationsApiPath } from '@/lib/public-query';
import type { Relations } from '@/lib/relations';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): the server page is the 90-day map;
// ?days=7|30 are read in the browser from the same public /api/relations.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/relations/');

export default async function Page() {
  const baseline = await publicJson<Relations>(relationsApiPath(RELATIONS_PERIOD));
  return (
    <Suspense fallback={<RelationMapView days={RELATIONS_PERIOD} load={{ status: 'ready', data: baseline }} />}>
      <RelationMapFromUrl baseline={baseline} />
    </Suspense>
  );
}
