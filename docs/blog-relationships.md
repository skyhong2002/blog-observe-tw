# Relationships, discovery and topics

Phase base: `a01ac59` (`origin/main`, fetched before implementation). This phase keeps the
Fastify / Drizzle / BullMQ / Next.js stack and tag-derived visual components. The
product measures links between independent publications, not news similarity or
plagiarism. Existing low-frequency/history policies remain in effect.

## Evidence and interpretation

An article observation identifies its source publication, URL, publication date,
fetch time and parser version. Body, blogroll, sidebar and comment links are kept
separate. Repeated links within one article do not inflate the default body-mention
count. A publication's citation share divides its distinct article-to-publication
body mentions by all its resolved body mentions. It is not a share of visits or a
claim that one writer endorses another. Missing publication dates stay unknown.

Platform publications keep their subdomain/path identities. A platform homepage is
never a personal blog. Unknown/ambiguous links retain the original article URL and
reason; they are not silently collapsed to the platform host. Failed refreshes
must not erase the last successful evidence. Coverage and truncation are visible.

## Bounded discovery

Every external request uses the existing public-address DNS pinning, robots policy,
identifiable User-Agent, per-site spacing, redirect validation and response cap.
New jobs run on the existing isolated queue at concurrency one. Durable daily
reservations are consumed before work, including failed attempts. Admission still
requires verified publication identity and a usable RSS/Atom or sitemap; AI cannot
bypass network protections, establish URL ownership, or override a human decision.

Initial limits: 300 article-page attempts/day, 20 HTTP requests/origin/day (including robots and redirects), 50 new link
candidates/day, 10 automatic admissions/day, discovery depth 3, and 100 extracted
external links/article. Limits are upper bounds, not a crawling target. A worker
batch also has page and wall-clock bounds. Newly admitted publications retain their
provenance depth rather than becoming new roots. Exhaustion defers work.

## AI inference

The gateway alias is `sky-quality`. Credentials come only from the environment or
`~/.config/ai-gateway/t3-client.key`. No credentials or raw prompts are committed or
included in review packets. Budget: at most 10 attempts/day, including retries;
bounded input/output and durable token reservations. Cache identity includes task,
policy, model alias and exact input digest. Failures defer with bounded backoff.

Classification, summaries and extracted topics are derived observations, labelled
**AI 推定**, with provenance. They never overwrite curated descriptions or community,
manual or author tags. Untrusted website text cannot instruct the gateway to fetch
URLs or perform actions. Inconclusive classification remains a candidate with a
reason, without asking users to perform routine review.

## Shared vocabulary

Use tag's public versioned export when available; stage a complete snapshot and
validate every page/checksum before switching the local current version. Preserve
source, version, coverage and synchronization time. The proposed upstream export
covers `all-current-indexed-article-tags`, which is distinct from an editorially
maintained dictionary. On 2026-10-12 its public endpoint returned 404. Until it is released, use the
existing public `/api/v1/articles` cursor API to synchronize a fixed observed
article window with `observed-article-window` coverage. Do not describe window
terms as a complete vocabulary or modify tag to make the export available.

Own RSS categories remain independent evidence. Deterministic title/body/category
matches and AI topics are different sources. Topic periods are 7, 30 and 90 days,
based on publication dates. For n distinct posts by a blog about a term, its
contribution is `2 * (1 - 0.5 ** n)` (increments 1, 0.5, 0.25, …).

## Release and rollback

Back up only `blog_observe` and restore-test the backup before additive migrations.
No tag or youtube schema, code, queues or schedules are changed. Build an immutable
release from pushed main, verify isolated ports, then switch blog's own services.
Each release verifies blog `/`, `/healthz`, Google OAuth initiation and sibling
HTTP 200. Rollback stops new job writers/schedulers, restores the prior release and
keeps additive evidence tables intact. Human Google consent remains a final user
acceptance step.

### Implemented activation and transport

The worker also scans one due publication homepage per batch (weekly refresh,
10 home attempts/day), follows at most one explicit same-publication blogroll
page, and stores those observations independently of article posts. The 50/day
candidate budget and immutable admission depth are shared across both discovery
paths. Article and homepage requests together are capped at 900 actual HTTP
requests/day, including robots and redirects. Candidate verification has its own
300 requests/day and 20/origin/day cap. Failures never bypass robots or SSRF checks.

Sitemap-only candidates can qualify only with verified site-level personal identity
and an actually fetched same-publication `BlogPosting`/`Article`, Person author,
canonical URL and body hash. Probe limits are three sitemap documents/two levels
and three article documents. A sitemap alone is not proof of a personal blog.

AI reserves 10 attempts/day and 80,000 conservative token-budget units (complete
request UTF-8 bytes plus bounded completion allowance). Classification/profile/topic
work has separate task allowances to prevent one task from consuming all calls.
Only `CLI_PROXY_API_KEY` or the private client key file is used. Manual overrides
are explicitly restricted to blog profiles and post topics; they cannot grant
publication admission. Error records contain only sanitized diagnostic codes.

The published article-window API is read from `BLOG_TAG_API_ORIGIN`, restricted to
`http://127.0.0.1:18130` or `https://tag.observe.tw`. Production uses loopback with
500ms spacing; public fallback uses at least 1100ms. No client forwarding headers,
sessions or API credentials are relayed. HTTP429 respects Retry-After with bounded
retries and persistent deferral; rendering always uses local data. Complete-export
deployment is a separate [tag proposal](tag-vocabulary-export-proposal.md).

### Database compatibility

New tables explicitly use `utf8mb4_unicode_ci`, matching the existing blog tables;
MariaDB server defaults may differ. Drizzle schema generation must retain this
explicit option in CREATE TABLE migration statements. No existing table is
converted as part of this feature. Snapshot IDs, exact hashes and normalized-label
comparisons retain their own explicit identity validation.

Homepage and child-blogroll observations publish as one successful sweep. A failed
child retains the previous complete generation as stale, clears conditional
homepage headers and schedules a fresh attempt; vanished/changed child pages are
removed on the next successful complete sweep. The admission transaction's broad
publication-ownership locks are retained for correctness. A restored-production-size
concurrency check waited 157ms behind an intentionally locked crawler row and then
completed without deadlock; all external requests remain outside SQL transactions.
Transport falls back only for identifiable connection failures. An overall
AbortSignal timeout/deadline defers work rather than duplicating an uncertain call
through the public origin.
