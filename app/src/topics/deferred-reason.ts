/** Bounded operational codes only: never return raw driver messages, SQL, URLs or credentials. */
export function topicDeferredReason(error: unknown): string {
  const value = error as { code?: unknown; name?: unknown; message?: unknown } | null;
  const message = typeof value?.message === 'string' ? value.message : '';
  const http = /^Tag source HTTP ([45]\d{2})$/.exec(message);
  if (http) return `upstream-http-${http[1]}`;
  if (value?.name === 'TimeoutError' || message === 'Tag request deadline' || message === 'Tag retry deferred by deadline')
    return 'upstream-timeout';
  if (value?.name === 'AbortError') return 'upstream-aborted';
  if (message === 'Tag request failed') return 'upstream-network';
  if (message === 'job lease lost') return 'lease-lost';
  if (
    typeof value?.code === 'string' &&
    [
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'ER_QUERY_INTERRUPTED',
      'ER_CON_COUNT_ERROR',
      'ER_BAD_FIELD_ERROR',
      'ER_PARSE_ERROR',
      'ER_WRONG_VALUE_COUNT_ON_ROW',
      'ER_DATA_TOO_LONG',
      'ER_TRUNCATED_WRONG_VALUE',
      'PROTOCOL_CONNECTION_LOST',
      'ECONNRESET',
      'ETIMEDOUT',
    ].includes(value.code)
  )
    return `database:${value.code}`;
  return 'unexpected-error';
}
