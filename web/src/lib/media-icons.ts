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
