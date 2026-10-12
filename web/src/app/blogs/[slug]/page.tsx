import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BlogContentSources from '@/components/BlogContentSources';
import BlogInference from '@/components/BlogInference';
import BlogRelations from '@/components/BlogRelations';
import BlogTopics from '@/components/BlogTopics';
import SimilarwebTraffic from '@/components/SimilarwebTraffic';
import SourceProfile from '@/components/SourceProfile';
import { plainText } from '@/lib/api';
import { getBlog } from '@/lib/public-api';
import { decodeParam, isSlug } from '@/lib/public-query';
import { blogPath, breadcrumbSchema, pageMetadata, serializeJsonLd, shortText } from '@/lib/seo';

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
  // A 404 here, not only in the page, so a missing blog is never streamed as a 200.
  if (!blog) notFound();
  const description =
    shortText(plainText(blog.description)) || `${shortText(blog.name, 60)}的最新文章、內文來源與共同話題，收錄於部落格觀察。`;
  return pageMetadata(blogPath(blog.slug), blog.name, description);
}
export default async function BlogDetailPage({ params }: Props) {
  const blog = await blogOf(params);
  if (!blog) notFound();
  const breadcrumb = breadcrumbSchema([
    ['/blogs/', '部落格目錄'],
    [blogPath(blog.slug), blog.name],
  ]);
  return (
    <>
      {/* Public blog name only; serializeJsonLd escapes '<'. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
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
