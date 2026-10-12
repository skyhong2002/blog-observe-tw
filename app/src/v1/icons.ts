import catalog from '../../data/favicon-catalog.json' with { type: 'json' };
import type { IconManifest } from './favicon-routes.ts';

// Outlet favicons are stored on this site (web/public/favicons, refreshed by
// tools/fetch-favicons.ts) because many original URLs 404, refuse foreign
// requests or are .ico files the image optimizer rejects. Outlets without a
// stored copy fall back to the catalog URL.
export const FAVICON_BASE = 'https://blog.observe.tw/favicons/';
const original = catalog as unknown as Record<string, { icon: string | null; verified?: boolean }>;

export function iconUrl(media: string, current: IconManifest): string | null {
  if (Object.hasOwn(current, media)) {
    const revision = current[media].revision;
    return `${FAVICON_BASE}${media}.png${revision ? `?v=${revision}` : ''}`;
  }
  const entry = original[media];
  return entry?.verified && /^https?:\/\//i.test(entry.icon ?? '') ? (entry.icon?.replace(/^http:\/\//, 'https://') ?? null) : null;
}
