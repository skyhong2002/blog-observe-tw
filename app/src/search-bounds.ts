export const HISTORICAL_BODY_LIMIT = 200;
export const SEARCH_STATEMENT_MS = 250;
/** Algorithm version only: not a body revision/hash or an observation timestamp.
 * Current body evidence is reread in SQL; per-hit provenance needs a separate reviewed DTO contract.
 */
export const SEARCH_MATCH_VERSION = 'literal-metadata-ingestion-v2';
export const PUBLIC_SEARCH_SQL = "b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())";
/** Read the current private body row, with matching article/publication ownership. */
export const CURRENT_BODY_SQL = "c.status='ok' AND c.blog_id=p.blog_id";
export function literalSearchPattern(q: string) {
  return `%${q.replace(/[=%_]/g, '=$&')}%`;
}
/** MariaDB enforces this on the server; a Promise timeout would leave SQL running. */
export function boundedSearchStatement(sql: string, enabled: boolean) {
  return enabled ? `SET STATEMENT max_statement_time=${SEARCH_STATEMENT_MS / 1000} FOR ${sql}` : sql;
}
export function isSearchTimeout(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: string; errno?: number }) : {};
  return code.code === 'ER_STATEMENT_TIMEOUT' || code.code === 'ER_QUERY_INTERRUPTED' || code.errno === 1969 || code.errno === 1317;
}
