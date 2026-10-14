// The homepage's centre: recent article→blog body citations (app/src/relations/home-feed.ts loadHomeMentions),
// the same direct-link evidence /relations/ counts. Each row is one article citing one blog; the two directions of
// a pair are separate rows with their own dates. Sidebar, blogroll and comment links, shared tags and text
// similarity are never rows here and never called an exchange. The rows come first; how they are chosen is in the
// page's 本頁的資料來源與計算方式 (FooterMethod). Markup reuses home.module.css's story list.

import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import { displayTitle, type HomeMention, type HomeMentions, taipei } from '@/lib/api';
import { externalHref } from '@/lib/images';
import { blogLink } from '@/lib/page-links';
import styles from './home.module.css';

const EVIDENCE_LABEL = '正文直接連結';
/** contextSource is a public enum; the contract admits only 'body'. */
const CONTEXT_SOURCE: Record<HomeMention['contextSource'], string> = { body: '文章正文' };

function MentionRow({ m }: { m: HomeMention }) {
  const original = externalHref(m.postUrl);
  const title = displayTitle(m.postTitle).trim() || '未提供標題';
  return (
    <article className={styles.story} data-mention={`${m.postId}:${m.targetBlogId}`}>
      <div className={styles.storyBody}>
        <p className={styles.storyTags}>
          <Link {...blogLink(m.sourceBlogSlug, m.sourceBlogCanonicalPath)} className="inline-flex items-center gap-1.5">
            <BlogIcon media={m.sourceBlogSlug} iconUrl={m.sourceIconUrl} title={m.sourceBlogName} />
            {m.sourceBlogName}
          </Link>
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
        <p className={styles.source}>
          <span>{EVIDENCE_LABEL}</span>
          <span aria-hidden="true">→</span>
          <Link {...blogLink(m.targetBlogSlug, m.targetBlogCanonicalPath)} className="inline-flex items-center gap-1.5">
            <BlogIcon media={m.targetBlogSlug} iconUrl={m.targetIconUrl} title={m.targetBlogName} />
            {m.targetBlogName}
          </Link>
          {m.targetDomain ? <span data-target-domain="">{m.targetDomain}</span> : null}
          <span>· {m.publishedAt ? <time dateTime={m.publishedAt}>{taipei(m.publishedAt)}</time> : '發文日期不明'}</span>
        </p>
        <details className={styles.muted}>
          <summary>核對這筆連結</summary>
          <p>連結文字：{m.anchor.trim() ? `「${m.anchor}」` : '未提供'}</p>
          <p>上下文：{m.context.trim() ? `「${m.context}」` : '未提供'}</p>
          <p>
            觀測 {m.observedAt ? taipei(m.observedAt) : '未提供'} · 解析版本 {m.matchVersion || '未提供'} · 上下文來源{' '}
            {CONTEXT_SOURCE[m.contextSource] ?? '未提供'}
          </p>
        </details>
      </div>
    </article>
  );
}

export default function HomeMentionsSection({ mentions }: { mentions: HomeMentions }) {
  return (
    <section className={styles.center} aria-label="最近的正文引用">
      <div className={styles.sectionHeading}>
        <h2>最近的正文引用</h2>
        <Link href="/relations/">關係圖 →</Link>
      </div>
      {mentions.items.length ? (
        <div className={styles.storyList}>
          {mentions.items.map((m) => (
            <MentionRow key={`${m.postId}:${m.targetBlogId}`} m={m} />
          ))}
          <Link href="/relations/" className={styles.more}>
            {mentions.truncated ? `只列最近 ${mentions.limit} 筆 · ` : ''}看全站關係圖 <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <p className={styles.notice}>近 {mentions.days} 天沒有可列出的正文直接引用；這不代表各站之間沒有連結。</p>
      )}
    </section>
  );
}
