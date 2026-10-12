import { type EdgeState, SLOTS } from './state.ts';

export function failureCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z_]+(?::\/[a-z0-9/.-]*)?$/.test(value) ? value : 'deployment_probe_failed';
}
export class SwitchFailure extends Error {
  readonly primaryCode: string;
  readonly rollbackCode: string | null;
  constructor(code: string, primary: unknown, rollback?: unknown) {
    super(code);
    this.primaryCode = failureCode(primary);
    this.rollbackCode = rollback === undefined ? null : failureCode(rollback);
  }
}
export type EdgeProbe = (path: string, port: number, accept?: string) => Promise<Response>;
export async function acknowledgeEdge(
  state: EdgeState,
  probe: EdgeProbe,
  options: {
    attempts?: number;
    wait?: (ms: number) => Promise<unknown>;
  } = {},
) {
  const attempts = Math.max(1, Math.min(10, options.attempts ?? 10));
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const matches = (response: Response) =>
    response.headers.get('x-blog-edge-generation') === String(state.generation) && response.headers.get('x-blog-release') === state.commit;
  let last: unknown = Error('edge_did_not_acknowledge');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const health = await probe('/healthz', 18160);
      const body = (await health.json()) as { ok?: boolean; port?: number };
      if (!health.ok || !body.ok || body.port !== SLOTS[state.active].gateway || !matches(health)) throw Error('edge_health_mismatch');
      const page = await probe('/', 18160, 'text/html');
      const html = await page.text();
      if (page.status !== 200 || !/<(?:html|!DOCTYPE)/i.test(html)) throw Error('edge_homepage_unavailable');
      if (!matches(page)) throw Error('edge_homepage_release_mismatch');
      return;
    } catch (error) {
      last = error;
    }
    if (attempt + 1 < attempts) await wait(500);
  }
  throw Error(failureCode(last));
}

/** The caller already published next under its flock. Never point at an unchecked old target. */
export async function confirmOrRestore({
  before,
  next,
  acknowledge,
  checkOld,
  publishRollback,
}: {
  before: EdgeState;
  next: EdgeState;
  acknowledge: (state: EdgeState) => Promise<void>;
  checkOld: () => Promise<void>;
  publishRollback: (state: EdgeState) => Promise<void>;
}) {
  try {
    await acknowledge(next);
    return;
  } catch (primary) {
    try {
      await checkOld();
    } catch (rollback) {
      throw new SwitchFailure('rollback_target_unhealthy', primary, rollback);
    }
    const restored = { ...before, generation: next.generation + 1 };
    try {
      await publishRollback(restored);
    } catch (rollback) {
      throw new SwitchFailure('rollback_publish_failed', primary, rollback);
    }
    try {
      await acknowledge(restored);
    } catch (rollback) {
      throw new SwitchFailure('rollback_ack_failed', primary, rollback);
    }
    throw new SwitchFailure('switch_failed_rolled_back', primary);
  }
}

/** An operator stop is successful; an unsolicited child signal remains failure. */
export function wrapperExitCode(stopping: boolean, code: number | null, signal: NodeJS.Signals | null): number {
  if (stopping && (signal === 'SIGTERM' || signal === 'SIGINT')) return 0;
  return code ?? 1;
}

export class ReadinessFailure extends Error {
  readonly retryable: boolean;
  constructor(code: string, retryable = false) {
    super(code);
    this.retryable = retryable;
  }
}
/** Only transport/transient HTTP failures get a short startup allowance. */
export async function pollReadiness(
  check: () => Promise<void>,
  options: {
    attempts?: number;
    wait?: (ms: number) => Promise<unknown>;
  } = {},
) {
  const attempts = Math.max(1, Math.min(6, options.attempts ?? 6));
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await check();
      return;
    } catch (error) {
      if (!(error instanceof ReadinessFailure) || !error.retryable || attempt + 1 === attempts) throw error;
    }
    await wait(1000);
  }
}
