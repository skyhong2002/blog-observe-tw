import { ACTIVE_TOPIC_LIMITS, digest, POLICY_VERSION, payloadObject } from './policy.ts';

export type ActiveLimits = { [K in keyof typeof ACTIVE_TOPIC_LIMITS]: number };
export type ActiveState = {
  activeTerms: number;
  codePoints: number;
  estimatedBytes: number;
  eligibleTerms: number;
  budgetReached: boolean;
  selectionId: string;
};
export type ActiveTerm = {
  id: string;
  label: string;
  normalizedLabel: string;
  articleCount: number;
  lastPublishedAt: Date | null;
  exclusionReason: string | null;
};
export function estimatedMatcherBytes(codePoints: number, terms: number, limits: ActiveLimits = ACTIVE_TOPIC_LIMITS) {
  return limits.bytesPerNode * (codePoints + 1) + limits.bytesPerTerm * terms;
}
export function startActiveSelection(snapshotId: string, asOf: Date): ActiveState {
  return {
    activeTerms: 0,
    codePoints: 0,
    estimatedBytes: estimatedMatcherBytes(0, 0),
    eligibleTerms: 0,
    budgetReached: false,
    selectionId: digest(JSON.stringify([snapshotId, asOf.toISOString(), POLICY_VERSION, ACTIVE_TOPIC_LIMITS])),
  };
}
/** Mutates only a bounded accumulator; callers stream in articleCount DESC, canonical ID DESC order. */
export function admitActiveTerm(
  state: ActiveState,
  term: ActiveTerm,
  asOf: Date,
  limits: ActiveLimits = ACTIVE_TOPIC_LIMITS,
): string | null {
  if (term.exclusionReason) return null; // The separate policy exclusion explains why this term is not matched.
  const count = [...term.normalizedLabel].length;
  const last = term.lastPublishedAt?.getTime() ?? NaN;
  const recent = last <= asOf.getTime() && last >= asOf.getTime() - limits.recentDays * 86_400_000;
  if (count < 2 || !(term.articleCount >= limits.minArticleCount || recent)) return 'low-frequency';
  state.eligibleTerms++;
  const nextTerms = state.activeTerms + 1;
  const nextPoints = state.codePoints + count;
  const bytes = estimatedMatcherBytes(nextPoints, nextTerms, limits);
  if (state.budgetReached || nextTerms > limits.maxTerms || nextPoints > limits.maxCodePoints || bytes > limits.maxEstimatedBytes) {
    state.budgetReached = true;
    return 'memory-budget';
  }
  state.activeTerms = nextTerms;
  state.codePoints = nextPoints;
  state.estimatedBytes = bytes;
  // Chained digest can be checkpointed exactly; no serialized crypto Hash state or complete ID array.
  state.selectionId = digest(
    JSON.stringify([state.selectionId, term.id, term.label, term.articleCount, term.lastPublishedAt?.toISOString() ?? null]),
  );
  return null;
}
export function sourceTermMetadata(payload: unknown, windowObservedAt: Date | null, asOf: Date) {
  const raw = payloadObject(payload);
  const count =
    typeof raw.articleCount === 'number' && Number.isSafeInteger(raw.articleCount) && raw.articleCount >= 0 ? raw.articleCount : 0;
  const parsed = typeof raw.lastPublishedAt === 'string' ? new Date(raw.lastPublishedAt) : null;
  const last = parsed && Number.isFinite(parsed.getTime()) ? parsed : windowObservedAt;
  return { articleCount: Math.min(2_147_483_647, count), lastPublishedAt: last && last <= asOf ? last : null };
}
