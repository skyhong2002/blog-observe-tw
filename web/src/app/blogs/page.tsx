import { Suspense } from 'react';
import BlogCatalogView, { BlogCatalogFromUrl } from '@/components/public/BlogCatalog';
import { catalog } from '@/lib/public-api';
import { staticPageMetadata } from '@/lib/seo';

// ISR (PUBLIC_REVALIDATE_SECONDS): the prerendered page is the unfiltered first
// page; ?q=&category=&status=&sort=&dir=&page=&limit= are answered in the
// browser from the same public /api/catalog.
export const revalidate = 120;
export const metadata = staticPageMetadata('/blogs/');

export default async function BlogsPage() {
  const baseline = await catalog();
  return (
    <Suspense fallback={<BlogCatalogView catalog={baseline} filters={baseline.filters} status="ready" />}>
      <BlogCatalogFromUrl baseline={baseline} />
    </Suspense>
  );
}
