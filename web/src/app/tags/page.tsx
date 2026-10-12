import { Suspense } from 'react';
import TagExplorerView, { TagExplorerFromUrl } from '@/components/public/TagExplorer';
import { overview } from '@/lib/public-api';
import { staticPageMetadata } from '@/lib/seo';

// ISR (PUBLIC_REVALIDATE_SECONDS): the prerendered page lists the tags; ?tag= is
// loaded in the browser from the public /api/tags/:slug.
export const revalidate = 120;
export const metadata = staticPageMetadata('/tags/');

export default async function TagsPage() {
  const { tags } = await overview();
  return (
    <Suspense fallback={<TagExplorerView tags={tags} tag={null} detail={null} />}>
      <TagExplorerFromUrl tags={tags} />
    </Suspense>
  );
}
