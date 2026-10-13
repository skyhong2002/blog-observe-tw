import type { Pool } from 'mysql2/promise';
import { SHARED_LABEL_CONTRACT } from './shared-label-contract.ts';
import { loadSharedLabelSnapshot } from './shared-label-store.ts';

type TopicEvidence = {
  topic: { id: string; label: string; source: string; excludedReason?: string | null } | null;
  articles: unknown[];
  history?: { total: number };
};
type Reader = typeof loadSharedLabelSnapshot;

/** Optional local metadata only: never construct a client or perform upstream I/O during a page read. */
export async function enrichTopicSharedLabels<T extends TopicEvidence>(
  pool: Pool,
  detail: T,
  options: { enabled?: boolean; read?: Reader; now?: Date } = {},
) {
  const topic = detail.topic;
  const enabled = options.enabled ?? process.env.BLOG_SHARED_LABELS_PUBLIC_ENABLED === 'true';
  // Upstream labels do not create blog topic pages or revive revoked evidence.
  if (
    !enabled ||
    !topic ||
    topic.source !== 'tag-vocabulary' ||
    !/^tag:[0-9a-f]{64}$/.test(topic.id) ||
    topic.excludedReason ||
    !(detail.articles.length > 0 || Number(detail.history?.total) > 0)
  )
    return { ...detail, sharedLabels: { status: 'not-enabled' as const } };
  const read = options.read ?? loadSharedLabelSnapshot;
  const now = options.now ?? new Date();
  const unavailable = () => ({
    status: 'unavailable' as const,
    fetchedAt: null,
    expiresAt: null,
    sourceContractSha: SHARED_LABEL_CONTRACT.sourceSHA,
    payloadVersion: null,
  });
  const safeRead = async (kind: 'relations' | 'visual') => {
    try {
      return await read(pool, topic.label, kind, now);
    } catch {
      // Optional metadata storage failure must not replace the public topic's own article evidence.
      return unavailable();
    }
  };
  const [relations, visual] = await Promise.all([safeRead('relations'), safeRead('visual')]);
  return {
    ...detail,
    sharedLabels: { status: 'enabled' as const, source: 'https://tag.observe.tw' as const, relations, visual },
  };
}
