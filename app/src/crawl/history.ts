import { type BlogToCrawl, canonicalArticleUrl, isNonSyndicationSource, parseSitemapArticle, politeFetch, readFeedBody } from './feed.ts';
import {
  historyInPublication,
  historySourceInScope,
  parseHistoryHome,
  parseHistoryWordpress,
  parseHistoryXml,
  restoreEntry,
} from './history-parse.ts';
import type {
  HistoryCaps,
  HistoryKind,
  HistoryOptions,
  HistoryPageResult,
  HistoryRun,
  HistoryStore,
  HistoryTask,
} from './history-types.ts';

export type { HistoryOptions, HistoryRun, HistoryStore } from './history-types.ts';

function bound(value: number | undefined, fallback: number, ceiling: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) throw new Error('invalid_history_budget');
  return value;
}
const empty = (warnings: string[] = []): HistoryPageResult => ({ tasks: [], entries: [], fetched: true, warnings });
function blocked(reason: string, retryMs = 6 * 60 * 60 * 1000) {
  return Object.assign(new Error(reason), { retryMs });
}
/** Persist only fixed categories/known SQL codes: never URLs, response bodies or DB error text. */
export function historyFailureReason(error: unknown): string {
  const err =
    error && typeof error === 'object'
      ? (error as { name?: string; message?: string; code?: string; cause?: { code?: string }; sqlState?: string })
      : {};
  const message = typeof err.message === 'string' ? err.message : '';
  const code = typeof err.code === 'string' ? err.code : typeof err.cause?.code === 'string' ? err.cause.code : '';
  if (code === 'HISTORY_LIMIT') return 'history_total_limit';
  if (/^robots disallow(?:\s|$)/i.test(message) || message === 'history_robots_denied') return 'history_robots_denied';
  if (/^history_http_[1-5][0-9]{2}$/.test(message)) return message;
  const knownReasons = new Set([
    'history_source_ownership_changed',
    'history_blog_identity_changed',
    'history_task_changed',
    'history_task_missing',
    'history_entry_missing',
    'history_entry_identity_changed',
    'history_redirect_outside_publication',
    'history_pagination_metadata_invalid',
    'history_entry_outside_publication',
    'history_child_source_changed',
  ]);
  if (knownReasons.has(message)) return message;
  if (
    ['TimeoutError', 'AbortError'].includes(err.name || '') ||
    ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code)
  )
    return 'history_timeout';
  if (/response exceeds|body.*limit/i.test(message) || code === 'ERR_BUFFER_TOO_LARGE') return 'history_body_limit';
  if (message === 'invalid_xml_source') return 'history_invalid_xml';
  if (err.name === 'SyntaxError' || message === 'invalid_wordpress_source') return 'history_invalid_json';
  if (message === 'invalid gzip feed response') return 'history_invalid_gzip';
  const sqlCodes = new Set([
    'ER_DATA_TOO_LONG',
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
    'ER_DUP_ENTRY',
    'ER_BAD_FIELD_ERROR',
    'ER_NO_SUCH_TABLE',
    'ER_PARSE_ERROR',
    'ER_WARN_DATA_OUT_OF_RANGE',
    'ER_TRUNCATED_WRONG_VALUE',
    'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
    'ER_NO_REFERENCED_ROW_2',
    'ER_CON_COUNT_ERROR',
    'ER_SERVER_SHUTDOWN',
  ]);
  if (sqlCodes.has(code)) return `history_sql_${code.toLowerCase()}`;
  if (code.startsWith('ER_') || typeof err.sqlState === 'string') return 'history_sql_error';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'history_dns_error';
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'PROTOCOL_CONNECTION_LOST'].includes(code))
    return 'history_connection_error';
  if (/unsafe crawl (?:URL|address)|target does not match validated DNS/i.test(message)) return 'history_unsafe_target';
  if (/too many redirects/i.test(message)) return 'history_redirect_limit';
  return 'history_fetch_or_write_failed';
}

async function readTask(task: HistoryTask, blog: BlogToCrawl, options: HistoryOptions): Promise<HistoryPageResult> {
  if (['feed', 'sitemap', 'wordpress'].includes(task.kind) && isNonSyndicationSource(task.url))
    return { ...empty(['non-syndication-source']), fetched: false };
  if (task.kind === 'entry') {
    if (!task.payload?.entry) throw new Error('history_entry_missing');
    const entry = restoreEntry(task.payload.entry);
    if (canonicalArticleUrl(entry.url) !== task.url || !historyInPublication(entry.url, blog.url))
      throw new Error('history_entry_identity_changed');
    return { ...empty(), entries: [entry], fetched: false };
  }
  const response = await politeFetch(
    task.url,
    {
      accept:
        task.kind === 'wordpress' ? 'application/json' : 'application/xml,text/xml,text/html,application/rss+xml,application/atom+xml',
    },
    options,
  );
  const finalUrl = response.url || task.url;
  if (!(task.kind === 'article' ? historyInPublication(finalUrl, blog.url) : historySourceInScope(finalUrl, blog, task.sourceUrl)))
    throw blocked('history_redirect_outside_publication');
  if ([401, 403, 429].includes(response.status)) {
    const retry = response.headers.get('retry-after');
    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
    throw blocked(`history_http_${response.status}`, Math.max(6 * 3600000, Math.min(Number.isFinite(delay) ? delay : 0, 7 * 86400000)));
  }
  if ([404, 410].includes(response.status)) return empty(task.payload?.optional ? [] : ['unavailable-source-or-article']);
  if (task.kind === 'wordpress' && response.status === 400 && Number(new URL(task.url).searchParams.get('page')) > 1) {
    const body = await response.text();
    try {
      if (JSON.parse(body)?.code === 'rest_post_invalid_page_number') return { ...empty(), archiveSeen: true };
    } catch {
      /* A malformed error is not an end-of-archive marker. */
    }
    throw blocked('history_http_400');
  }
  if (!response.ok) throw blocked(`history_http_${response.status}`);
  if (task.kind === 'feed' || task.kind === 'sitemap') {
    const body = await readFeedBody(response);
    try {
      return parseHistoryXml(body, task, blog, finalUrl, response.headers);
    } catch (error) {
      if (task.payload?.optional) return empty(['unavailable-optional-source-invalid']);
      throw error;
    }
  }
  const body = await response.text();
  if (task.kind === 'wordpress') {
    try {
      return parseHistoryWordpress(body, task, blog, finalUrl, response.headers);
    } catch (error) {
      if (task.payload?.optional) return empty(['unavailable-optional-source-invalid']);
      throw error;
    }
  }
  if (task.kind === 'home') return parseHistoryHome(body, task, blog, finalUrl);
  const entry = parseSitemapArticle(
    body,
    {
      guid: task.url,
      url: task.url,
      title: '',
      summary: '',
      author: null,
      imageUrl: null,
      categories: [],
      publishedAt: null,
      updatedAt: task.payload?.lastmod ? new Date(task.payload.lastmod) : null,
    },
    finalUrl,
  );
  return { ...empty(entry ? [] : ['article-unparsed']), entries: entry ? [entry] : [] };
}

/** A bounded batch; finishing a listing only persists its work queue, never implies its articles are complete. */
export async function runHistoryBatch(
  store: HistoryStore,
  blog: BlogToCrawl,
  options: HistoryOptions = {},
): Promise<HistoryRun | { blogId: number; status: 'busy' }> {
  const maxPages = bound(options.maxPages, 5, 1000);
  const maxArticles = bound(options.maxArticles, 30, 10000);
  const duration = bound(options.maxDurationMs, 60000, 3600000);
  const caps: HistoryCaps = {
    maxTotalPages: bound(options.maxTotalPages, 10000, 1000000),
    maxTotalArticles: bound(options.maxTotalArticles, 100000, 1000000),
    maxTasks: bound(options.maxTasks, 200000, 2000000),
  };
  const now = options.now || (() => new Date());
  if (!(await store.acquire())) return { blogId: blog.id, status: 'busy' };
  try {
    const initial = await store.initialize(blog, caps, now());
    if (initial.nextAttemptAt && new Date(initial.nextAttemptAt).getTime() > now().getTime()) return initial;
    const deadline = Date.now() + duration;
    let pages = 0,
      articles = 0;
    while (Date.now() < deadline) {
      const kinds: HistoryKind[] = [];
      if (pages < maxPages) kinds.push('home', 'feed', 'sitemap', 'wordpress');
      if (articles < maxArticles) kinds.push('entry', 'article');
      const task = await store.nextTask(blog.id, kinds);
      if (!task) break;
      try {
        await store.assertLease();
        const result = await readTask(task, blog, options.passiveBatch ? { ...options, observer: options.passiveBatch.observer } : options);
        await store.assertLease();
        await store.commitTask(blog, task, result, caps, now());
        await options.passiveBatch?.commit(result.entries.map((entry) => entry.url));
        if (task.kind === 'article' || task.kind === 'entry') articles++;
        else pages++;
      } catch (error) {
        options.passiveBatch?.discard();
        const code = (error as { code?: string }).code;
        const limited = code === 'HISTORY_LIMIT';
        const reason = historyFailureReason(error);
        const policyBlock = reason === 'history_robots_denied' || /^history_http_(401|403|429)$/.test(reason);
        if (!limited && !policyBlock && (await store.failTask(blog, task, reason, now()))) {
          if (task.kind === 'article' || task.kind === 'entry') articles++;
          else pages++;
          continue;
        }
        const delay = (error as { retryMs?: number }).retryMs || 6 * 3600000;
        await store.defer(blog.id, reason, limited ? null : new Date(now().getTime() + delay), limited ? 'limited' : 'blocked', now());
        break;
      }
    }
    return await store.finish(blog.id, now());
  } finally {
    options.passiveBatch?.discard();
    await store.release();
  }
}
