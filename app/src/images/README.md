# Bounded local image derivatives

The gateway exposes GET/HEAD `/images/posts/:id/:width.webp` (160/320/640/960)
and `/images/icons/:slug/:size.webp` (16/32/64/96). Widths are allowlisted. Articles
must belong to a verified blog and must not be future-published. Every article
request, including disk hits and conditional responses, rechecks the public row.
Only its existing `image_url` is fetched; query parameters cannot supply a URL.
Private request headers are never forwarded. Icons read only the existing local
PNG runtime/bundled directory, with bounded reads and final-component symlink
rejection. Missing originals return 404; blocked/failed transformations return
502 without source URLs, credentials, or underlying exception messages.

External sources use `politeFetch`: robots, identifying UA, host delay, DNS pinning,
public addresses/ports, checked redirects and 5 MiB response limits. Only raster
MIME types are accepted, and the decoder additionally checks binary signatures
and actual format. Native sharp runs in a credential-free child process with an
8-second parent kill deadline, 16,777,216-pixel limit, one native thread, disabled
native cache and bounded input/output. AVIF is accepted as sharp `heif` only with `av1` compression; generic
`mif1`/`msf1` brands must pass that same metadata check (otherwise fail closed). Only the first frame is rendered. Four
WebP variants are generated together without enlargement, quality 76.

`BLOG_IMAGE_CACHE_ROOT` defaults to `~/.cache/blog-observe/images-v1`; use the same
location across gateway releases and CLI prewarming. Cache keys hash source URL
(or local PNG bytes), transformation version and width; source URLs are not
persisted. Each variant is fsynced before atomic hard-link publication; reads verify the
RIFF declared size to reject truncated files.
Existing files are never overwritten or removed. A cross-process exclusive
kernel `flock` covers fetching, decoding and writing. Its inode is retained;
the lock holder exits on the owner's stdin EOF, including gateway/CLI death.
There is no PID/mtime-based takeover and no automatic lock-file deletion.
Do not launch independent image workers with different cache roots on the same
production host.

A durable `.usage.json` ledger is initialized by one bounded directory scan under
the lock. Later cold requests read this small ledger instead of opening/statting
every image. Output bytes are reserved and fsynced before image publication; a
crash can conservatively consume unused budget but cannot free it to competing
writers. Interrupted `.pending-*` image files are retained and covered by their
reservation. An interrupted `.usage.pending` metadata publication stops new
writes until an operator inspects it; it is not silently deleted/reused. Do not
manually add cache files behind the ledger. Fixed metadata has an 8 KiB reserve.

New cache writes stop below 10 GiB available disk or at 256 MiB cache usage; initialization
also stops for an unexpected cache directory entry or over 65,536 entries.
Existing valid images still serve. There is no eviction or automatic cleanup.
Gateway misses have bounded single-flight tracking (8 keys), no unbounded wait
queue, and a 256-key/30-second negative cache. A busy writer returns a short
failure without populating the negative cache, allowing the frontend to use its
original image fallback and a later request to retry immediately. Public image
responses cache for 300 seconds with an ETag; errors are no-store.

`node --env-file-if-exists=.env tools/prewarm-images.ts` first selects the homepage
lead plus six latest posts, then retains only verified posts with images (hard
cap 20). It processes posts first, followed by existing local icons from the
homepage's first 8 authors, 7 visible posts and 10 recent blogs. Those three
ordered sets are bounded before filtering; their slugs are deduplicated to at
most 25. Missing sources do not pull other off-page sources into the batch.
The three read-only selection queries retain the homepage ordering but skip
article bodies, global statistics and source fetches.

Both phases are sequential. Each post source is fetched once for all four
variants; icons call the local PNG service only and never fetch a network
fallback. Output contains only `posts` / `icons` counts: `sources`, `success`,
`failed`, and `variants: {success, failed}`. A source succeeds only when all four
variants are available; partial variants are counted separately. Fatal CLI
errors use only `image_prewarm_failed`, without raw URLs or database details.
The tool never bypasses robots, changes database records, or accepts a URL
argument. Prewarm before switching UI traffic to avoid cold icon requests
contending with the single writer and falling back to PNG.

Runtime cache invalidation follows changes to the stored image URL; a same-URL
upstream replacement needs an explicitly managed transformation version update.
