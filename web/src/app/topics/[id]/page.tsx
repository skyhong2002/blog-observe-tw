import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import TopicDetailView, { TopicDetailFromUrl } from '@/components/public/TopicDetail';
import { indexabilityNote, TOPIC_DETAIL_PERIOD } from '@/lib/page-links';
import { getPublicPage, publicJsonOrNull } from '@/lib/public-api';
import { topicApiPath } from '@/lib/public-query';
import { breadcrumbSchema, detailPageMetadata, serializeJsonLd, shortText } from '@/lib/seo';
import type { TopicDetail } from '@/lib/topics';
import type { PublicLoad } from '@/lib/use-public-json';

// ISR (PUBLIC_REVALIDATE_SECONDS), generated on first request and never at build:
// the page is the 90-day view (the indexability window); ?days=7|30 are read in
// the browser from /api/topics/:id.
export const revalidate = 120;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };
/**
 * The segment is a readable key or a legacy tag:/rss: id, already decoded once
 * by Next (never decoded again). The page registry resolves it to the stable
 * tag:<hash> that the topic API is read by. Unknown keys and a gateway 404
 * are the page's 404; generateMetadata and the page share both reads, so a
 * missing topic is never streamed as a 200. A valid thin topic is a 200 with
 * noindex,follow.
 */
async function topicOf(params: Props['params']) {
  const page = await getPublicPage('topic', (await params).id);
  if (!page) notFound();
  const data = await publicJsonOrNull<TopicDetail>(topicApiPath(page.stableId, TOPIC_DETAIL_PERIOD));
  if (!data?.topic) notFound();
  return { page, data, topic: data.topic };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page, topic } = await topicOf(params);
  const label = shortText(topic.label, 60);
  return detailPageMetadata(page, `「${label}」話題`, `近 90 天台灣部落格中提到「${label}」的文章與部落格，依共同關鍵字整理。`);
}

export default async function Page({ params }: Props) {
  const { page, data, topic } = await topicOf(params);
  const baseline: PublicLoad<TopicDetail> = { status: 'ready', data };
  const breadcrumb = breadcrumbSchema([
    ['/topics/', '大家正在寫什麼'],
    [page.canonicalPath, topic.label],
  ]);
  // API reads use the stable id; tabs and links the canonical path.
  const view = { id: page.stableId, path: page.canonicalPath, note: indexabilityNote(page, 'topic') };
  return (
    <>
      {/* Public topic label only; serializeJsonLd escapes '<'. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      <Suspense fallback={<TopicDetailView {...view} days={TOPIC_DETAIL_PERIOD} load={baseline} />}>
        <TopicDetailFromUrl {...view} baseline={baseline} />
      </Suspense>
    </>
  );
}
