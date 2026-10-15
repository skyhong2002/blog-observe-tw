/** Bounded operational metadata only. Never log SQL, driver messages, URL, parameters or causes. */
const stages = new Set([
  'home.mentions',
  'home.authors',
  'home.totals',
  'home.recentBlogs',
  'home.icons',
  'full.posts',
  'full.tags',
  'full.authors',
  'full.blogs',
  'full.totals',
  'full.recentBlogs',
  'full.icons',
]);
const networkCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);
const integer = (value: unknown, max = 100_000): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : null;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

export function overviewPoolState(pool: unknown) {
  // mysql2 PromisePool exposes the underlying Pool. These are optional diagnostics:
  // injected pools or future driver versions may not expose them; missing is not zero.
  const core = record(record(pool).pool);
  const size = integer(record(core._allConnections).length);
  const free = integer(record(core._freeConnections).length);
  return {
    size,
    free,
    active: size !== null && free !== null ? Math.max(0, size - free) : null,
    queued: integer(record(core._connectionQueue).length),
    limit: integer(record(core.config).connectionLimit),
  };
}

class OverviewReadFailure extends Error {
  readonly queryStage: string;
  readonly elapsedMs: number;
  readonly poolState: ReturnType<typeof overviewPoolState>;
  readonly failure: ReturnType<typeof failureMetadata>;
  constructor(queryStage: string, elapsedMs: number, poolState: ReturnType<typeof overviewPoolState>, error: unknown) {
    super('overview_read_failed');
    this.failure = failureMetadata(error);
    this.queryStage = queryStage;
    this.elapsedMs = elapsedMs;
    this.poolState = poolState;
  }
}
export async function overviewRead<T>(pool: unknown, stage: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } catch (error) {
    throw new OverviewReadFailure(stage, Math.round(performance.now() - start), overviewPoolState(pool), error);
  }
}

function failureMetadata(error: unknown) {
  const cause = record(error);
  const databaseCode =
    typeof cause?.code === 'string' && (/^(?:ER_|PROTOCOL_)[A-Z0-9_]{1,64}$/.test(cause.code) || networkCodes.has(cause.code))
      ? cause.code
      : 'unknown';
  const databaseErrno = integer(cause?.errno, 65535);
  const sqlState = typeof cause?.sqlState === 'string' && /^[0-9A-Z]{5}$/.test(cause.sqlState) ? cause.sqlState : null;
  const admissionBusy = cause?.message === 'topic_cache_busy' && cause?.statusCode === 503;
  const failureKind = admissionBusy
    ? 'admission-busy'
    : cause?.message === 'Queue limit reached.'
      ? 'pool-queue-limit'
      : cause?.message === 'Pool is closed.'
        ? 'pool-closed'
        : databaseErrno === 1969 || databaseCode === 'ER_STATEMENT_TIMEOUT'
          ? 'statement-timeout'
          : databaseErrno === 1205
            ? 'lock-timeout'
            : databaseErrno === 1213
              ? 'deadlock'
              : networkCodes.has(databaseCode) || databaseCode.startsWith('PROTOCOL_')
                ? 'connection-error'
                : databaseErrno !== null || databaseCode.startsWith('ER_')
                  ? 'database-error'
                  : 'unknown';
  return { failureKind, databaseCode, databaseErrno, sqlState };
}

export function overviewFailureDetails(error: unknown, pool: unknown) {
  const scoped = error instanceof OverviewReadFailure ? error : null;
  const failure = scoped?.failure ?? failureMetadata(error);
  return {
    queryStage:
      scoped && stages.has(scoped.queryStage) ? scoped.queryStage : failure.failureKind === 'admission-busy' ? 'admission' : 'unknown',
    ...failure,
    readElapsedMs: scoped && Number.isFinite(scoped.elapsedMs) ? Math.min(600_000, Math.max(0, scoped.elapsedMs)) : null,
    poolState: scoped?.poolState ?? overviewPoolState(pool),
  };
}
