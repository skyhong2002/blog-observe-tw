import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import type { ProfileMentionFeed } from '@/components/ProfileMentionList';
import { getBlog, getPublicPage, publicJson } from '@/lib/public-api';
import { blogMentionFeedApiPath, mentionRssPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import { pageMetadata, shortText } from '@/lib/seo';
import MoreMentions from './MoreMentions';

// Rendered per request (no-store reads), like the blog page: a citation an admin has since hidden never lives on in
// a stored page. The first page is read here; older pages in the browser. A failed first read does not fail the page.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };
async function blogOf(params: Props['params']) {
  const page = await getPublicPage('blog', (await params).slug);
  if (!page) notFound();
  const blog = await getBlog(page.stableId);
  if (!blog) notFound();
  return { page, blog };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page, blog } = await blogOf(params);
  const name = shortText(blog.name, 60);
  return pageMetadata(
    `${page.canonicalPath}mentions/`,
    `誰提到了${name}`,
    `其他台灣部落格在文章裡寫到「${name}」的段落與原文連結，依發文時間排列，可用 RSS 訂閱。`,
  );
}
export default async function BlogMentionsPage({ params }: Props) {
  const { page, blog } = await blogOf(params);
  const first = await publicJson<ProfileMentionFeed>(blogMentionFeedApiPath(blog.slug)).catch((error: unknown) => {
    if (error instanceof PublicGatewayError) return null;
    throw error;
  });
  return (
    <div className="space-y-5 pb-8">
      <header>
        <p className="text-sm">
          <Link href={page.canonicalPath} className="text-brand-700 hover:underline dark:text-brand-400">
            ← {blog.name}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold">誰提到了{blog.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <a href={mentionRssPath(blog.slug)} className="text-brand-700 hover:underline dark:text-brand-400">
            RSS 訂閱
          </a>{' '}
          · <MethodLink />
        </p>
      </header>
      <MoreMentions slug={blog.slug} first={first} />
    </div>
  );
}
