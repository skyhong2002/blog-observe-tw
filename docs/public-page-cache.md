# Public page cache (ISR)

Public pages are prerendered and regenerated in the background every
**120 seconds** (`PUBLIC_REVALIDATE_SECONDS`, `web/src/lib/public-paths.ts`).
Next.js answers them from its ISR cache with
`Cache-Control: s-maxage=120, stale-while-revalidate=…`, which the gateway
passes through. Nothing is forced: the cache headers come from real ISR
entries in `.next/prerender-manifest.json`.

## Edge (Cloudflare) and what the HTML may contain

The deployed Cloudflare rule caches only the blog host's `GET` without a
query string, without `Cookie` and without `Authorization`, and not RSC
requests; for those it honours the origin's cache headers. No other edge rule
is needed for this change. That works because:

- Prerendered HTML is the same for every visitor. The layout reads no cookies
  or headers; the account menu asks `/auth/me` in the browser. The home page
  has no personal content.
- The query never changes the HTML, so a URL with a query (which the edge does
  not cache anyway) gets the same document as without.
- Private responses (`/auth/*`, `/me/*`, `/api/me/*`, `/api/admin/*`) are
  `private, no-store` from the gateway with a complete `Vary`; they are never
  read by `public-api.ts` and never part of an ISR page.
- `/my/` is a generic static shell (no visitor data, no session); the
  follows, feed and OPML are read in the browser from private, no-store
  gateway responses. Session data is never rendered into ISR output.

## Freshness

Freshness is layered, so 120 s is the usual refresh interval, not a hard
real-time guarantee:

1. Gateway responses carry their own short caches (for example
   `/api/overview` and `/api/catalog` `max-age=30`, topics/relations/search
   `60` or in-process projections of up to 5 minutes).
2. Next's fetch cache keeps each public read for 120 s; during a page
   regeneration a stale entry is fetched again in the foreground.
3. The ISR page is regenerated in the background on the first request after
   120 s; that request and any others during regeneration get the previous
   page (`stale-while-revalidate`).
4. The edge may keep the page per the origin headers.
5. In the browser, query answers are remembered for 120 s (below).

A failed regeneration keeps the previous page, so during gateway trouble a
page can be older than 120 s; that is preferred over an empty one.

## Which pages

| Route | Rendering | Prerendered content | Read in the browser |
| --- | --- | --- | --- |
| `/` | ISR 120 s | overview, 30-day topics | — |
| `/ranking/` | ISR 120 s | overview tags | — |
| `/traffic/` | ISR 120 s | all listed blogs' traffic | table state `sort, month, q, state, view, page, compare` (no refetch) |
| `/blogs/` | ISR 120 s | catalog page 1, default sort | `q, category, status, sort, dir, page, limit` → `/api/catalog` |
| `/authors/` | ISR 120 s | authors page 1 | `author, page, limit` → `/api/catalog/authors` |
| `/articles/` | ISR 120 s | latest posts | `q, page, blog` → `/api/search` |
| `/tags/` | ISR 120 s | tag list | `tag` → `/api/tags/:slug` |
| `/topics/` | ISR 120 s | 30-day ranking | `days=7\|90` → `/api/topics` |
| `/relations/` | ISR 120 s | 90-day map | `days=7\|30` → `/api/relations` |
| `/blogs/[slug]/` | ISR 120 s, on demand | profile, sidebar, relations, topics, inference | in-page `q` filter (no fetch) |
| `/topics/[id]/` | ISR 120 s, on demand | 30-day topic | `days=7\|90` → `/api/topics/:id` |
| `/about/`, `/my/` | static shell (ISR 120 s via the footer's catalog total) | no visitor data | `/my/` reads the reader's follows with credentials, uncached |
| `/login/` | dynamic | — | reads `?error=` on the server; cheap, auth flow |
| `/admin/`, `/admin/discovery/` | dynamic (`force-dynamic`) | — | admin console reads its own APIs, uncached |
| `/healthz` | dynamic | — | — |

Dynamic routes return `[]` from `generateStaticParams` with
`dynamicParams = true`: nothing is fetched or rendered for them at build, and
each slug/id is rendered on its first request and then cached like the others.
Only slug-shaped blog segments and the gateway's topic id shapes are looked up;
anything else is a 404 without a gateway call, which keeps junk URLs from
filling the cache with lookups.

## Server reads: `public-api.ts`

`web/src/lib/public-api.ts` (`import 'server-only'`) is the only way server
components read the gateway:

- GET only, fixed init (`accept: application/json`, `redirect: 'error'`,
  10 s timeout, `next.revalidate = 120`); there is no init/header parameter,
  so no Cookie or Authorization can reach a shared response.
- Only paths `isPublicApiPath` allows: `/api/overview`, `/api/catalog`,
  `/api/catalog/authors`, `/api/search`, `/api/topics[/:id]`,
  `/api/relations`, `/api/traffic`, `/api/tags/:slug`, `/api/blogs/:slug` and
  its `relations|topics|inference|content`, each with a fixed set of query
  keys. `/api/me`, `/api/admin`, `/auth`, `/me`, reader paths, encoded
  slashes and dot segments are refused before any request.
- 2xx → JSON, which must pass the payload contract for that path
  (`public-contracts.ts`, below). 404 → `publicJsonOrNull` returns `null`
  (only a real HTTP 404: a missing blog becomes the page's 404; a blog without
  inference/content shows its existing note). 502/503/504 → one retry after
  2 s. Anything else, network failure, unreadable JSON or a 200 of the wrong
  shape → `PublicGatewayError` is thrown. Bodies that are not read (404,
  retry, error) are cancelled so they do not hold the connection.
- Throwing is deliberate: a background regeneration that throws keeps serving
  the last good page, and a first render that throws is an uncached error.
  Gateway trouble is never cached as an empty list or a 404. Validation runs
  inside the shared read, before any component could catch it.
- `BlogContentSources` only asks for slugs the content route accepts
  (`^[a-z0-9][a-z0-9-]{0,199}$`; it answers 400 to others) and shows its
  "no data" note for the rest.

The rules live in `public-read.ts` (pure, tested with a fake fetch). The old
no-store `gateway()` moved to `server-gateway.ts` (`server-only`) for private
server reads; nothing public uses it. `api.ts` now holds only types and
formatting, so client components can import it without bundling the internal
origin.

The footer's collection total is best-effort: it uses the public catalog read
but swallows failures, since it is on every page including private ones.

## Payload contracts: `public-contracts.ts`

One check per public path kind, shared by the server read and the browser
loader, written from the gateway routes in `app/src` (overview, catalog,
authors, search, topics, topic detail, relations, traffic, tag, blog and the
blog's relations/topics/inference/content). They require the containers and
keys the pages index into (`blog.slug/name`, `topic.id/label`, `items`,
`coverage.nonBodyLinks`, `pagination`, …) with the right types, never that a
list has rows. Valid empty answers — no posts, an empty topic list, no
relations, no traffic, `profile: null`, `vocabulary.status: 'unavailable'`,
content `disabled`/`pending` — stay normal pages; `{}`, `null`, arrays, text
or a wrong-typed container are failures.

## Browser reads: query pages

Prerendered HTML never depends on the query, so a query cannot poison the
cache and no proxy/rewrite is involved. Each query page renders:

```tsx
<Suspense fallback={<XView …baseline />}>
  <XFromUrl baseline={baseline} />
</Suspense>
```

- The fallback is the readable baseline, so the first HTML is never blank.
  The view is a client component, so the baseline data is sent once.
- `XFromUrl` reads `useSearchParams()`. Without a query it shows the
  baseline; with one it calls `usePublicJson(path, parse)`
  (`use-public-json.ts`, logic in `public-loader.ts`): same-origin,
  `credentials: 'omit'`, whitelisted paths only, payload contract checked.
  Until the answer for the current path arrives the view is `pending` (frame
  and filters shown, rows hidden).
- Each read has a 10 s timeout, separate from the abort used when the query
  changes or the view unmounts: a timeout shows the view's error state, never
  an endless pending. Each run captures its own parser, and an aborted or
  superseded run neither settles nor writes the cache, so an older query
  answering or parsing late never replaces a newer one.
- Answers are remembered for 120 s, at most 24 paths (least recently used
  out), so back/forward is instant while fresh; going back to a query whose
  answer has expired reads it again. A page left open does not poll.
- URLs, links, sorting, paging, 7/30/90 tabs, tag/author ids and full-text
  search keep their old shape, so they stay shareable.
- Query results need JavaScript: without it a query URL shows the baseline
  (and the edge does not cache query URLs). An invalid `?author=` now shows
  "找不到這位作者" instead of an HTTP 404.

## Checking

```sh
BLOG_GATEWAY_INTERNAL_URL=http://127.0.0.1:18167 npm --prefix web run build
# Route table: ○ / ● with "Revalidate 2m"; ƒ only for /login, /admin, /healthz.
jq '.routes | keys' web/.next/prerender-manifest.json
jq '.dynamicRoutes | keys' web/.next/prerender-manifest.json   # /blogs/[slug], /topics/[id]
```

Tests:

- `web/test/public-cache.test.ts`: whitelist, read rules (status handling,
  retry, body cancel, wrong-shaped 200s throw, valid empty answers pass),
  route contract.
- `web/test/public-contracts.test.ts`: every kind has a contract; valid empty
  payloads pass; `{}` / `null` / wrong types fail.
- `web/test/public-loader.test.ts`: TTL and LRU eviction, timeout, 404 vs
  error, aborted and superseded reads never settle or cache (injected clock,
  timers and fetch).
- `web/test/public-query.test.ts`: URL query logic, including a comparison
  with the gateway's own `catalogFilters`.
- Fixtures shaped after the gateway routes: `web/test/public-payloads.ts`.
