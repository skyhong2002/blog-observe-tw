import { Suspense } from 'react';
import ArticlesView, { ArticlesFromUrl } from '@/components/public/Articles';
import { articleFiltersOf } from '@/lib/article-filters';
import { overview } from '@/lib/public-api';
import { NO_SEARCH } from '@/lib/search';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): the server page lists the latest posts;
// ?q=&page=&blog= full-text search runs in the browser through the public /api/search.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/articles/');

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const filters = articleFiltersOf(query);
  const { posts } = await overview();
  return (
    <Suspense fallback={<ArticlesView asked={NO_SEARCH} latest={posts} search={null} filters={filters} />}>
      <ArticlesFromUrl latest={posts} />
    </Suspense>
  );
}
