import { Suspense } from 'react';
import AuthorCatalogView, { AuthorCatalogFromUrl } from '@/components/public/AuthorCatalog';
import { authorCatalog } from '@/lib/public-api';

// ISR (PUBLIC_REVALIDATE_SECONDS): the prerendered page is the first page of all
// authors; ?author=&page=&limit= are answered in the browser from /api/catalog/authors.
export const revalidate = 120;

export default async function AuthorsPage() {
  const baseline = await authorCatalog();
  return (
    <Suspense fallback={<AuthorCatalogView selected={false} status="ready" data={baseline} />}>
      <AuthorCatalogFromUrl baseline={baseline} />
    </Suspense>
  );
}
