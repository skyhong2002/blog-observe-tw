import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import TopicDetailView, { TopicDetailFromUrl } from '@/components/public/TopicDetail';
import { publicJsonOrNull } from '@/lib/public-api';
import { decodeParam, isTopicId, TOPICS_PERIOD, topicApiPath } from '@/lib/public-query';
import { breadcrumbSchema, pageMetadata, serializeJsonLd, shortText, topicPath } from '@/lib/seo';
import type { TopicDetail } from '@/lib/topics';
import type { PublicLoad } from '@/lib/use-public-json';

// ISR (PUBLIC_REVALIDATE_SECONDS), generated on first request and never at build:
// the page is the 30-day view; ?days=7|90 are read in the browser from /api/topics/:id.
export const revalidate = 120;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };
/**
 * Only the gateway's id shapes are looked up (and cached); anything else, and a
 * gateway 404 (no such topic), is the page's 404. generateMetadata and the page
 * share the read, and both 404 so a missing topic is never streamed as a 200.
 */
async function topicOf(params: Props['params']) {
  const id = decodeParam((await params).id);
  if (!isTopicId(id)) notFound();
  const data = await publicJsonOrNull<TopicDetail>(topicApiPath(id, TOPICS_PERIOD));
  if (!data?.topic) notFound();
  return { id, data, topic: data.topic };
}

/** An alias canonicalises to its merged tag:… topic; otherwise the topic is its own canonical. */
const canonicalTopicId = (id: string, canonicalId?: string | null) => (canonicalId && isTopicId(canonicalId) ? canonicalId : id);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, topic } = await topicOf(params);
  const label = shortText(topic.label, 60);
  return pageMetadata(
    topicPath(canonicalTopicId(id, topic.canonicalId)),
    `「${label}」話題`,
    `近 30 天台灣部落格中提到「${label}」的文章與部落格，依共同關鍵字整理。`,
  );
}

export default async function Page({ params }: Props) {
  const { id, data, topic } = await topicOf(params);
  const baseline: PublicLoad<TopicDetail> = { status: 'ready', data };
  const breadcrumb = breadcrumbSchema([
    ['/topics/', '大家正在寫什麼'],
    [topicPath(canonicalTopicId(id, topic.canonicalId)), topic.label],
  ]);
  return (
    <>
      {/* Public topic label only; serializeJsonLd escapes '<'. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      <Suspense fallback={<TopicDetailView id={id} days={TOPICS_PERIOD} load={baseline} />}>
        <TopicDetailFromUrl id={id} baseline={baseline} />
      </Suspense>
    </>
  );
}
