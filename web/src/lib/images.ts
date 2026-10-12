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

// Same-origin WebP derivatives, rendered and cached by the gateway. They are
// requested directly by the browser (never through the Next image proxy), and
// a 404 only means no derivative exists; callers then use the original URL.
/** Widths of GET /images/posts/{id}/{width}.webp. */
export const POST_IMAGE_WIDTHS = [160, 320, 640, 960] as const;
export type PostImageWidth = (typeof POST_IMAGE_WIDTHS)[number];
/** Sizes of GET /images/icons/{slug}/{size}.webp. */
export const ICON_IMAGE_SIZES = [16, 32, 64, 96] as const;
export type IconImageSize = (typeof ICON_IMAGE_SIZES)[number];

/** A public post ID, or null: the derivative route only knows positive integer IDs. */
export function postImageId(id: unknown): number | null {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function postImageUrl(id: number, width: PostImageWidth): string {
  return `/images/posts/${id}/${width}.webp`;
}

/** What an <img> loads: `src`, plus the original to try once if it fails. */
export type ImageSources = { src: string; fallback: string | null };

/**
 * Sources for an article image. Without a valid original there is no image at
 * all (the derivative is made from it); without a post ID the original is used
 * as before. `width` is the one derivative the caller's box needs.
 *
 * Deliberately no `w` srcSet: the gateway resizes withoutEnlargement, so a 40px
 * original is still 40px at /960.webp, and a `960w` descriptor would claim an
 * intrinsic width the file does not have. Until the payload carries the
 * original's real width, each caller asks for a single derivative sized for
 * its box at about 2x, and a small original is simply served at its own size.
 */
export function articleImageSources(id: unknown, src: string | null | undefined, width: PostImageWidth): ImageSources | null {
  const original = articleImage(src);
  if (!original) return null;
  const post = postImageId(id);
  if (post === null) return { src: original, fallback: null };
  return { src: postImageUrl(post, width), fallback: original };
}

/**
 * What to load now: the derivative, or (once it failed) the original exactly
 * once. `last` means a failure of this attempt is final and the caller drops
 * the image; there is never a third attempt or a loop back to the derivative.
 */
export function imageAttempt(sources: ImageSources | null, derivativeFailed: boolean): { src: string; last: boolean } | null {
  if (!sources) return null;
  if (sources.fallback && derivativeFailed) return { src: sources.fallback, last: true };
  return { src: sources.src, last: !sources.fallback };
}

/**
 * The outcome of an error event on the <img> showing `erroredSrc`: the next
 * `failed` marker for imageAttempt, and whether the caller drops the image.
 * An event for any other src (stale, or a duplicate after the switch) changes
 * nothing, and the same event twice gives the same result, so a replayed and a
 * late real event never advance the fallback twice.
 */
export function afterImageError(
  sources: ImageSources | null,
  failed: string | null,
  erroredSrc: string,
): { failed: string | null; final: boolean } {
  const current = imageAttempt(sources, failed !== null && failed === sources?.src);
  if (!sources || !current || current.src !== erroredSrc) return { failed, final: false };
  return current.last ? { failed, final: true } : { failed: sources.src, final: false };
}

/** The parts of an <img> that say whether it already settled. */
export type SettledImage = { complete: boolean; naturalWidth: number; getAttribute(name: string): string | null };

/**
 * The load/error event an <img> showing `src` already fired, or null while it
 * is still loading or shows another src. A server-rendered image can settle
 * before React attaches its handlers; image-events.ts replays this once.
 */
export function missedImageEvent(img: SettledImage | null | undefined, src: string | null | undefined): 'load' | 'error' | null {
  if (!src || !img?.complete || img.getAttribute('src') !== src) return null;
  return img.naturalWidth ? 'load' : 'error';
}

/** Slugs the gateway stores favicons under (web/public/favicons/<slug>.png). */
export const SAFE_ICON_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
const SAFE_REVISION = /^[a-zA-Z0-9_-]{1,64}$/;

export function iconImageUrl(slug: string, size: IconImageSize, revision?: string | null): string {
  return `/images/icons/${encodeURIComponent(slug)}/${size}.webp${revision && SAFE_REVISION.test(revision) ? `?v=${revision}` : ''}`;
}

/**
 * 1x/2x/3x derivatives for an icon shown `px` CSS pixels wide, or null for an
 * unsafe slug or size. Unlike article widths, `x` descriptors stay honest here:
 * MediaIcon always sets width/height, so the box never follows the file, and a
 * withoutEnlargement derivative smaller than its density only looks no sharper
 * than the stored PNG. Each density takes the next endpoint size up, never more.
 */
export function iconImageSources(slug: string, px: number, revision?: string | null): { src: string; srcSet: string } | null {
  if (!SAFE_ICON_SLUG.test(slug) || !Number.isFinite(px) || px <= 0) return null;
  const pick = (n: number) => ICON_IMAGE_SIZES.find((size) => size >= n) ?? ICON_IMAGE_SIZES[ICON_IMAGE_SIZES.length - 1];
  const sizes = [...new Set([1, 2, 3].map((density) => pick(px * density)))];
  return {
    src: iconImageUrl(slug, sizes[0], revision),
    srcSet: sizes.map((size, i) => `${iconImageUrl(slug, size, revision)} ${i + 1}x`).join(', '),
  };
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
