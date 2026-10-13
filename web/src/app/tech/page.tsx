import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import TechStatsView, { TechStatsFromUrl, TechUnavailable } from '@/components/public/TechStats';
import { publicJsonOrNull } from '@/lib/public-api';
import { staticPageMetadata } from '@/lib/seo';
import { type TechStats, techApiPath } from '@/lib/tech';
import { techPublicEnabled } from '@/lib/tech-flag';

// Rendered per request (no-store reads, public-read.ts): the server page is the unfiltered first
// page; ?q=&technology=&status=&cursor= are answered in the browser from the same public /api/tech.
// Site switch off (BLOG_TECH_PUBLIC_ENABLED is not 'true'): a 404, before any gateway read.
// Site on but the gateway's own switch off (its 404): said so on the page, never an empty result.
// Any other gateway failure, a 200 public-contracts.ts rejects included, throws to app/error.tsx.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/tech/');

export default async function TechPage() {
  if (!techPublicEnabled()) notFound();
  const baseline = await publicJsonOrNull<TechStats>(techApiPath());
  if (!baseline) return <TechUnavailable />;
  return (
    <Suspense fallback={<TechStatsView data={baseline} filters={baseline.filters} status="ready" />}>
      <TechStatsFromUrl baseline={baseline} />
    </Suspense>
  );
}
