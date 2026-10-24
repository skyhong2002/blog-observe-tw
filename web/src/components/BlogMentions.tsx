// The blog page's 最近被這些部落格提到 (app/src/relations/home-feed.ts loadProfileMentions): the newest articles of
// other collected blogs that write about this blog in a sentence, as on the homepage. Body links only; nothing found
// leaves the section out, and what blank means is said once in the footer's 引用與交流 (FooterMethod.tsx).
import ReloadButton from '@/components/public/ReloadButton';
import { publicJsonOrNull } from '@/lib/public-api';
import { mentionRssPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import { blogPath } from '@/lib/seo';
import Link from './NoPrefetchLink';
import { MentionList, type ProfileMentions } from './ProfileMentionList';

const muted = 'text-zinc-500 dark:text-zinc-400';

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section id="mentions" aria-labelledby="mentions-title" className="mt-8 space-y-3">
      <h2 id="mentions-title" className="text-lg font-semibold">
        最近被這些部落格提到
      </h2>
      {children}
    </section>
  );
}

export default async function BlogMentions({ slug }: { slug: string }) {
  let data: ProfileMentions | null = null;
  try {
    data = await publicJsonOrNull<ProfileMentions>(`/api/blogs/${encodeURIComponent(slug)}/mentions`);
  } catch (error) {
    if (!(error instanceof PublicGatewayError)) throw error;
    return (
      <Section>
        <div role="alert" className={`text-sm ${muted}`}>
          <p>提到這個部落格的文章暫時無法載入，請稍後再試。</p>
          <ReloadButton />
        </div>
      </Section>
    );
  }
  if (!data?.items.length) return null;
  return (
    <Section>
      <MentionList items={data.items} />
      <MentionLinks slug={slug} more={data.truncated} />
    </Section>
  );
}

/** 看全部 (when the section was cut at 10) and the RSS an author can subscribe to (app/src/relations/mention-rss.ts). */
export function MentionLinks({ slug, more }: { slug: string; more: boolean }) {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {more && (
        <Link href={`${blogPath(slug)}mentions/`} className="text-brand-700 hover:underline dark:text-brand-400">
          看全部提到這個部落格的文章
        </Link>
      )}
      <a href={mentionRssPath(slug)} className="text-brand-700 hover:underline dark:text-brand-400">
        用 RSS 訂閱誰提到這個部落格
      </a>
    </p>
  );
}
