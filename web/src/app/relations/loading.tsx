import { RelationMapLoading } from '@/components/public/RelationMap';

// Sent at once while the server reads the 7-day map (no-store, page.tsx): the page's own header, period tabs and
// pending view, so a slow read shows the page instead of a blank screen. page.tsx never calls notFound(), and a
// failed read already falls back to the browser's own read, so streaming this first hides no 404 or 5xx.
export default function Loading() {
  return <RelationMapLoading />;
}
