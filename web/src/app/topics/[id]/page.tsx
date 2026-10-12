import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import TopicDetailView, { TopicDetailFromUrl } from '@/components/public/TopicDetail';
import { publicJsonOrNull } from '@/lib/public-api';
import { decodeParam, isTopicId, TOPICS_PERIOD, topicApiPath } from '@/lib/public-query';
import type { TopicDetail } from '@/lib/topics';
import type { PublicLoad } from '@/lib/use-public-json';

// ISR (PUBLIC_REVALIDATE_SECONDS), generated on first request and never at build:
// the page is the 30-day view; ?days=7|90 are read in the browser from /api/topics/:id.
export const revalidate = 120;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeParam((await params).id);
  // Only the gateway's id shapes are looked up (and cached); anything else is a 404.
  if (!isTopicId(id)) notFound();
  const data = await publicJsonOrNull<TopicDetail>(topicApiPath(id, TOPICS_PERIOD));
  const baseline: PublicLoad<TopicDetail> = data ? { status: 'ready', data } : { status: 'missing' };
  return (
    <Suspense fallback={<TopicDetailView id={id} days={TOPICS_PERIOD} load={baseline} />}>
      <TopicDetailFromUrl id={id} baseline={baseline} />
    </Suspense>
  );
}
