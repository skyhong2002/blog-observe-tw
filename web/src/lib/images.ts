/**
 * Article images are optional. Only a well-formed public https URL counts as an
 * image; anything else (null, blank, relative, other schemes, credentials, ports,
 * bare IPs or single-label hosts) means the article is laid out as text only,
 * with no placeholder and no reserved box. Blog favicons do not go through here.
 */
export function articleImage(src: string | null | undefined): string | null {
  const value = src?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname;
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return null;
  return value;
}

/** Load state of an optional article image. Wrappers render only while `loading`
 * or `loaded`; on `error` the image and its link unmount, leaving a text-only row. */
export type ImageState = 'loading' | 'loaded' | 'error';

/** Only absolute http(s) links are rendered as anchors to an original article. */
export function externalHref(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}
