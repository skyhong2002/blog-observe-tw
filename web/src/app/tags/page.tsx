import { Suspense } from 'react';
import TagExplorerView, { TagExplorerFromUrl } from '@/components/public/TagExplorer';
import { isPlatformDefaultTag } from '@/lib/platform-tags';
import { overview } from '@/lib/public-api';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): the server page lists the tags; ?tag= is
// loaded in the browser from the public /api/tags/:slug.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/tags/');

export default async function TagsPage() {
  // Same list as /ranking/: platform default categories are not tags anyone chose.
  const tags = (await overview()).tags.filter((t) => !isPlatformDefaultTag(t.label));
  return (
    <Suspense fallback={<TagExplorerView tags={tags} tag={null} detail={null} />}>
      <TagExplorerFromUrl tags={tags} />
    </Suspense>
  );
}
