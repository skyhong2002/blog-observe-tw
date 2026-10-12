import { Suspense } from 'react';
import RelationMapView, { RelationMapFromUrl } from '@/components/public/RelationMap';
import { publicJson } from '@/lib/public-api';
import { RELATIONS_PERIOD, relationsApiPath } from '@/lib/public-query';
import type { Relations } from '@/lib/relations';

// ISR (PUBLIC_REVALIDATE_SECONDS): the prerendered page is the 90-day map;
// ?days=7|30 are read in the browser from the same public /api/relations.
export const revalidate = 120;
export const metadata = { title: '部落格關係圖', description: '從正文連結看部落格之間的引用與交流。' };

export default async function Page() {
  const baseline = await publicJson<Relations>(relationsApiPath(RELATIONS_PERIOD));
  return (
    <Suspense fallback={<RelationMapView days={RELATIONS_PERIOD} load={{ status: 'ready', data: baseline }} />}>
      <RelationMapFromUrl baseline={baseline} />
    </Suspense>
  );
}
