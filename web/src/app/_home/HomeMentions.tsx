// The homepage's centre: recent article→blog body citations (app/src/relations/home-feed.ts loadHomeMentions),
// the same direct-link evidence /relations/ counts. The gateway sends flat article→blog rows; here one source
// article (its post id and blog) is one card, listing each blog it links to with that link's own evidence. The two
// directions of a pair are different source articles, so separate cards with their own dates. Sidebar, blogroll and
// comment links, shared tags and text similarity are never rows here and never called an exchange. How rows are
// chosen is in the page's 本頁的資料來源與計算方式 (FooterMethod). Markup reuses home.module.css's story list.

import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import PostTags from '@/components/PostTags';
import { displayTitle, type HomeMention, type HomeMentions, taipei } from '@/lib/api';
import { externalHref } from '@/lib/images';
import { blogLink } from '@/lib/page-links';
import styles from './home.module.css';
import NewsImage from './NewsImage';

/** One source article (post id + source blog) and the distinct blogs it links to, in the gateway's order. */
export type MentionCard = { key: string; article: HomeMention; targets: HomeMention[] };
/**
 * Groups flat rows by source article. Rows are never merged across different post ids (even with the same title)
 * or across source blogs; a repeated target blog for the same article keeps its first row only.
 */
export function mentionCards(items: readonly HomeMention[]): MentionCard[] {
  const cards = new Map<string, MentionCard>();
  for (const m of items) {
    const key = `${m.sourceBlogId}:${m.postId}`;
    const card = cards.get(key) ?? { key, article: m, targets: [] };
    if (!card.targets.some((t) => t.targetBlogId === m.targetBlogId)) card.targets.push(m);
    cards.set(key, card);
  }
  return [...cards.values()];
}

/** The gateway's sentence around the link (「…」 marks omitted text); older answers fall back to the raw context. */
const mentionQuote = (m: HomeMention) => (m.quote ?? m.context).trim() || m.anchor.trim();

/** Preserve the excerpt as text and restore only this citation's original linked words and destination. */
function MentionQuote({ mention }: { mention: HomeMention }) {
  const quote = mentionQuote(mention);
  if (!quote) return null;
  const anchor = mention.anchor.trim();
  const at = anchor ? quote.indexOf(anchor) : -1;
  const href = externalHref(mention.targetUrl);
  return (
    <p className={styles.mentionQuote}>
      「
      {href && at >= 0 ? (
        <>
          {quote.slice(0, at)}
          <a href={href} rel="noopener noreferrer">
            {anchor}
          </a>
          {quote.slice(at + anchor.length)}
        </>
      ) : (
        quote
      )}
      」
    </p>
  );
}

function MentionCardView({ card }: { card: MentionCard }) {
  const m = card.article;
  const original = externalHref(m.postUrl);
  const title = displayTitle(m.postTitle).trim() || '未提供標題';
  return (
    <article className={styles.story} data-mention-card={card.key}>
      <div className={styles.storyBody}>
        <p className={styles.mentionMeta}>
          <Link {...blogLink(m.sourceBlogSlug, m.sourceBlogCanonicalPath)} className={styles.mentionSource}>
            <BlogIcon media={m.sourceBlogSlug} iconUrl={m.sourceIconUrl} title={m.sourceBlogName} />
            {m.sourceBlogName}
          </Link>
          <span aria-hidden="true">·</span>
          {m.publishedAt ? <time dateTime={m.publishedAt}>{taipei(m.publishedAt)}</time> : <span>發文日期不明</span>}
        </p>
        <h3>
          {original ? (
            <a href={original} data-analytics="open_original" rel="noopener noreferrer">
              {title}
            </a>
          ) : (
            <span>{title}</span>
          )}
        </h3>
        <PostTags tags={m.postTags} total={m.postTagCount} max={3} className={styles.postTags} />
        <ul className={styles.mentionTargets} aria-label="這篇文章在正文連到的部落格">
          {card.targets.map((t) => (
            <li key={t.targetBlogId} data-mention={`${t.postId}:${t.targetBlogId}`}>
              <p className={styles.mentionTo}>
                <span aria-hidden="true">→</span>
                <Link {...blogLink(t.targetBlogSlug, t.targetBlogCanonicalPath)} className={styles.mentionChip}>
                  <BlogIcon media={t.targetBlogSlug} iconUrl={t.targetIconUrl} title={t.targetBlogName} />
                  {t.targetBlogName}
                </Link>
              </p>
              <MentionQuote mention={t} />
            </li>
          ))}
        </ul>
      </div>
      {/* The source article's own image (feed/og), only when it loads; never a placeholder. */}
      {original ? <NewsImage src={m.postImageUrl} href={original} analytics="open_original" title={title} variant="thumbnail" /> : null}
    </article>
  );
}

export default function HomeMentionsSection({ mentions }: { mentions: HomeMentions }) {
  const cards = mentionCards(mentions.items);
  return (
    <section className={styles.center} aria-label="最近的部落格引用">
      <div className={styles.sectionHeading}>
        <h2>最近的部落格引用</h2>
        <Link href="/relations/">關係圖 →</Link>
      </div>
      {mentions.status === 'unavailable' ? (
        <p className={styles.notice}>部落格引用暫時無法載入。</p>
      ) : cards.length ? (
        <div className={styles.storyList}>
          {cards.map((card) => (
            <MentionCardView key={card.key} card={card} />
          ))}
          <Link href="/relations/" className={styles.more}>
            看全站關係圖 <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
