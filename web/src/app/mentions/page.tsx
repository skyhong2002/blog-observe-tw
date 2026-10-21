import MethodLink from '@/components/MethodLink';
import RelationTabs from '@/components/RelationTabs';
import type { MentionFeed } from '@/lib/api';
import { publicJson } from '@/lib/public-api';
import { mentionsApiPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import { staticPageMetadata } from '@/lib/seo';
import MentionFeedView from './MentionFeed';

// Rendered per request (no-store reads, public-read.ts): the newest page of body citations; older pages are read in
// the browser as the reader scrolls. A first read that fails on the server (the shared host is often slow) does not
// fail the page: the browser reads it again itself.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/mentions/');

export default async function MentionsPage() {
  const first = await publicJson<MentionFeed>(mentionsApiPath()).catch((error: unknown) => {
    if (error instanceof PublicGatewayError) return null;
    throw error;
  });
  return (
    <div className="space-y-5 pb-8">
      <header>
        <RelationTabs current="mentions" />
        <h1 className="text-2xl font-semibold">部落格引用</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          誰在文章裡寫到誰 · <MethodLink />
        </p>
      </header>
      <MentionFeedView first={first} />
    </div>
  );
}
