import { Suspense } from 'react';
import ArticlesView, { ArticlesFromUrl } from '@/components/public/Articles';
import { overview } from '@/lib/public-api';
import { NO_SEARCH } from '@/lib/search';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): the server page lists the latest posts;
// ?q=&page=&blog= full-text search runs in the browser through the public /api/search.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/articles/');

export default async function ArticlesPage() {
  const { posts } = await overview();
  return (
    <Suspense fallback={<ArticlesView asked={NO_SEARCH} latest={posts} search={null} />}>
      <ArticlesFromUrl latest={posts} />
    </Suspense>
  );
}
