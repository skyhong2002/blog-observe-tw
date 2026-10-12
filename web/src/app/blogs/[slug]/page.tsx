import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BlogContentSources from '@/components/BlogContentSources';
import BlogInference from '@/components/BlogInference';
import BlogRelations from '@/components/BlogRelations';
import BlogTopics from '@/components/BlogTopics';
import SimilarwebTraffic from '@/components/SimilarwebTraffic';
import SourceProfile from '@/components/SourceProfile';
import { getBlog } from '@/lib/public-api';
import { decodeParam, isSlug } from '@/lib/public-query';

// ISR (PUBLIC_REVALIDATE_SECONDS), generated on first request and never at build
// (no list of every blog is fetched). The in-page ?q= post filter runs in the browser.
export const revalidate = 120;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };
/** Only slug-shaped segments are looked up (and cached); a gateway 404 is the page's 404. */
async function blogOf(params: Props['params']) {
  const slug = decodeParam((await params).slug);
  return isSlug(slug) ? getBlog(slug) : null;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const blog = await blogOf(params);
  return { title: blog?.name ?? '找不到部落格', description: blog?.description ?? undefined };
}
export default async function BlogDetailPage({ params }: Props) {
  const blog = await blogOf(params);
  if (!blog) notFound();
  return (
    <>
      <SourceProfile
        blog={blog}
        sidebar={
          <>
            <BlogContentSources slug={blog.slug} />
            <SimilarwebTraffic slug={blog.slug} compact />
          </>
        }
      />
      <BlogRelations slug={blog.slug} />
      <BlogTopics slug={blog.slug} />
      <BlogInference slug={blog.slug} />
    </>
  );
}
