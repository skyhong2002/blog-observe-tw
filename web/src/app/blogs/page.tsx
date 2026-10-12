import { Suspense } from 'react';
import BlogCatalogView, { BlogCatalogFromUrl } from '@/components/public/BlogCatalog';
import { catalog } from '@/lib/public-api';
import { pageMetadata } from '@/lib/seo';

// ISR (PUBLIC_REVALIDATE_SECONDS): the prerendered page is the unfiltered first
// page; ?q=&category=&status=&sort=&dir=&page=&limit= are answered in the
// browser from the same public /api/catalog.
export const revalidate = 120;
export const metadata = pageMetadata(
  '/blogs/',
  '部落格目錄',
  '台灣部落格目錄：依分類、更新狀態與最新發文瀏覽收錄的部落格，連回作者自己的網站閱讀。',
);

export default async function BlogsPage() {
  const baseline = await catalog();
  return (
    <Suspense fallback={<BlogCatalogView catalog={baseline} filters={baseline.filters} status="ready" />}>
      <BlogCatalogFromUrl baseline={baseline} />
    </Suspense>
  );
}
