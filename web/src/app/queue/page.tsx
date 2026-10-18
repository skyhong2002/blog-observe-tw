import { Suspense } from 'react';
import BlogQueueFromUrl, { BlogQueueView } from '@/components/public/BlogQueue';
import { staticPageMetadata } from '@/lib/seo';

// The query (?q=&state=&source=&page=) is answered in the browser from the public /api/blog-queue.
export const metadata = staticPageMetadata('/queue/');

export default function QueuePage() {
  return (
    <Suspense fallback={<BlogQueueView queue={null} status="pending" />}>
      <BlogQueueFromUrl />
    </Suspense>
  );
}
