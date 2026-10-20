// The blog page's 最近被這些部落格提到 (app/src/relations/home-feed.ts loadProfileMentions): the newest articles of
// other collected blogs that write about this blog in a sentence, as on the homepage. Body links only; nothing found
// leaves the section out, and what blank means is said once in the footer's 引用與交流 (FooterMethod.tsx).
import ReloadButton from '@/components/public/ReloadButton';
import { displayTitle, taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { publicJsonOrNull } from '@/lib/public-api';
import { PublicGatewayError } from '@/lib/public-read';
import { externalHref } from '@/lib/relations';
import BlogIcon from './BlogIcon';
import Link from './NoPrefetchLink';

export type ProfileMentions = {
  days: number;
  truncated: boolean;
  items: Array<{
    postId: number;
    postTitle: string;
    postUrl: string | null;
    publishedAt: string | null;
    sourceBlogSlug: string;
    sourceBlogName: string;
    sourceIconUrl?: string | null;
    anchor?: string;
    quote: string;
  }>;
};

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
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-800">
        {data.items.map((item) => {
          const url = externalHref(item.postUrl);
          const title = displayTitle(item.postTitle) || '未命名文章';
          return (
            <li key={item.postId} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                <Link
                  {...blogLink(item.sourceBlogSlug)}
                  className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-400"
                >
                  <BlogIcon media={item.sourceBlogSlug} iconUrl={item.sourceIconUrl} title={item.sourceBlogName} size={18} />
                  {item.sourceBlogName}
                </Link>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:underline">
                    〈{title}〉
                  </a>
                ) : (
                  <span className="min-w-0">〈{title}〉</span>
                )}
                {item.publishedAt && <span className={`text-xs tabular-nums ${muted}`}>{taipei(item.publishedAt)}</span>}
              </div>
              {item.quote && <p className={`line-clamp-2 text-sm ${muted}`}>{item.quote}</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
