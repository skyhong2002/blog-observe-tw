// Candidate review outcomes (app/src/crawl/candidate-validation.ts, candidate-promotion.ts) in the
// reader's words, for the 待查清單 and the note under an empty address search.

/** Where a candidate came from (discovery_candidates.source_type). */
export const CANDIDATE_SOURCES: Record<string, string> = {
  'reader-suggestion': '讀者新增',
  'blogblog-club': 'BlogBlog.Club 名單',
  'indieweb-wiki': 'IndieWeb 名單',
  indieping: 'IndiePing 名單',
  'article-link': '文章裡的連結',
  blogroll: '部落格友站連結',
  'seed-url-resolution': '種子名單',
};

/** First match wins; a spent daily budget is a wait, not a failure, so it says nothing. */
const REASONS: Array<[RegExp, string]> = [
  [/budget_exhausted/, ''],
  [/listing_not_chinese/, '首頁不是中文'],
  [/^homepage_|fetch_failed|timeout/, '首頁打不開'],
  [/personal|organization/, '還無法確認是個人部落格'],
  [/missing_identity_name/, '首頁沒有網站名稱'],
  [/identity|name/, '網站名稱和訂閱來源對不起來'],
  [/feed_entries_outside_publication/, '訂閱來源裡的文章不在這個網站'],
  [/rss|feed|sitemap/, '找不到可讀的 RSS／Atom 或文章 sitemap'],
  [/^robots_/, '網站的 robots.txt 讀不到或不允許'],
  [/platform_root|not_a_blog_publication|needs_publication_home|redirect_not_publication_home|shortener/, '不是部落格首頁'],
];

export const candidateReasonText = (reason: string | null) =>
  reason ? (REASONS.find(([pattern]) => pattern.test(reason))?.[1] ?? '未通過自動檢查') : '';
