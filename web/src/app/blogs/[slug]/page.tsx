import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BlogContentSources from '@/components/BlogContentSources';
import BlogInference from '@/components/BlogInference';
import BlogRelations from '@/components/BlogRelations';
import BlogTopics from '@/components/BlogTopics';
import SimilarwebTraffic from '@/components/SimilarwebTraffic';
import SourceProfile from '@/components/SourceProfile';
import { plainText } from '@/lib/api';
import { getBlog, getPublicPage } from '@/lib/public-api';
import { breadcrumbSchema, pageMetadata, serializeJsonLd, shortText } from '@/lib/seo';

// Rendered on every request, never cached or built: the blog's posts are the gateway's answer to this
// request (no-store reads, public-read.ts), so a post it has since hidden never lives on in a stored page.
// The in-page ?q= post filter runs in the browser.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };
/**
 * The segment is a readable key or a legacy slug, which Next passes
 * percent-encoded; getPublicPage decodes it exactly once. The page registry resolves it; the blog itself is
 * read by its stable API slug. Unknown keys and a gateway 404 are the page's 404.
 */
async function blogOf(params: Props['params']) {
  const page = await getPublicPage('blog', (await params).slug);
  if (!page) notFound();
  const blog = await getBlog(page.stableId);
  if (!blog) notFound();
  return { page, blog };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page, blog } = await blogOf(params);
  const description =
    shortText(plainText(blog.description)) || `${shortText(blog.name, 60)}的最新文章、內文來源與共同話題，收錄於部落格觀察。`;
  return pageMetadata(page.canonicalPath, blog.name, description);
}
export default async function BlogDetailPage({ params }: Props) {
  const { page, blog } = await blogOf(params);
  const breadcrumb = breadcrumbSchema([
    ['/blogs/', '部落格目錄'],
    [page.canonicalPath, blog.name],
  ]);
  return (
    <>
      {/* Public blog name only; serializeJsonLd escapes '<'. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      <SourceProfile
        blog={{ ...blog, canonicalPath: page.canonicalPath }}
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
