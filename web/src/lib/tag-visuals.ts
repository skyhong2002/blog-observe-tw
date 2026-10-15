import { checkedVisualPath, SHARED_LABEL_ORIGIN, sharedLabelUrl } from './shared-labels';

/**
 * tag.observe.tw's cloud pictures (place outlines, logos, emoji) for the masthead cloud, recoloured by tag to
 * the blog's green (`accent`, brand-500, readable on both themes). Public tag data, not blog content, so one
 * copy is kept per process for 30 minutes; a failed or slow fetch (1.5s) leaves the cloud text-only and is
 * retried after 5 minutes. Only paths that pass the shared-label checker for that exact tag are kept.
 */
export const CLOUD_VISUAL_ACCENT = '22c55e';
export type CloudVisual = { image?: string; emoji?: string };
const FRESH_MS = 30 * 60_000,
  RETRY_MS = 5 * 60_000;
let cached: { until: number; map: Map<string, CloudVisual> } | null = null;

export function parseCloudVisuals(raw: unknown): Map<string, CloudVisual> {
  const map = new Map<string, CloudVisual>();
  const visuals = raw && typeof raw === 'object' ? (raw as { visuals?: unknown }).visuals : null;
  if (!visuals || typeof visuals !== 'object' || Array.isArray(visuals)) return map;
  for (const [tag, value] of Object.entries(visuals)) {
    if (!value || typeof value !== 'object' || tag.length > 100) continue;
    const v = value as { image?: unknown; emoji?: unknown };
    const path = v.image == null ? null : checkedVisualPath(v.image, tag);
    const emoji = typeof v.emoji === 'string' && v.emoji.length > 0 && [...v.emoji].length <= 4 ? v.emoji : undefined;
    if (path) map.set(tag, { image: sharedLabelUrl(path) });
    else if (emoji) map.set(tag, { emoji });
  }
  return map;
}

export async function tagCloudVisuals(): Promise<Map<string, CloudVisual>> {
  if (cached && Date.now() < cached.until) return cached.map;
  try {
    const response = await fetch(`${SHARED_LABEL_ORIGIN}/api/v1/tag-visuals?accent=${CLOUD_VISUAL_ACCENT}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw Error('tag_visuals_unavailable');
    cached = { until: Date.now() + FRESH_MS, map: parseCloudVisuals(await response.json()) };
  } catch {
    cached = { until: Date.now() + RETRY_MS, map: cached?.map ?? new Map() };
  }
  return cached.map;
}
