// Public metadata comes from /api/icons. Never import the private source catalog
// into a client bundle: it contains discovery URLs and conditional-request state.
export type MediaIcons = Record<string, { revision?: string; dark?: 'invert' | 'outline' }>;
export const mediaIcons: MediaIcons = {};
export function localMediaIcon(id: string, icons = mediaIcons): string | null {
  if (!Object.hasOwn(icons, id)) return null;
  const revision = icons[id].revision;
  return `/favicons/${encodeURIComponent(id)}.png${revision ? `?v=${revision}` : ''}`;
}
export function mediaIconClass(id: string, icons = mediaIcons): string {
  const appearance = icons[id]?.dark;
  return appearance === 'invert' ? 'dark:invert' : appearance === 'outline' ? 'dark:drop-shadow-[0_0_1px_#fff]' : '';
}
// Fixed stand-in origin for resolving payload paths; one that resolves elsewhere
// would leave the page's real origin in the browser too.
const SAME_ORIGIN_BASE = 'https://same-origin.invalid';
/** A payload's iconUrl, kept only when it is a public https URL or a same-origin path. */
export function suppliedIconUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url.startsWith('/')) {
    // Browsers read `\` as `/` and drop tabs/newlines, turning `/\host` or `/<tab>/host` into `//host`.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are matched on purpose to reject them.
    if (url.startsWith('//') || /[\\\u0000-\u001f\u007f-\u009f]/.test(url)) return null;
    try {
      return new URL(url, SAME_ORIGIN_BASE).origin === SAME_ORIGIN_BASE ? url : null;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}
/**
 * The image to show for `id`, or null for the initial glyph. A refreshed
 * manifest entry carries the newest revision and wins; the payload's iconUrl
 * covers server rendering (empty manifest) and outlets the manifest lacks. A
 * source in `failed` is skipped, so a broken manifest file falls back to the
 * iconUrl and a broken iconUrl to the glyph.
 */
export function mediaIconSrc(id: string, icons: MediaIcons, iconUrl?: unknown, failed: readonly string[] = []): string | null {
  for (const candidate of [localMediaIcon(id, icons), suppliedIconUrl(iconUrl)]) {
    if (candidate && !failed.includes(candidate)) return candidate;
  }
  return null;
}
