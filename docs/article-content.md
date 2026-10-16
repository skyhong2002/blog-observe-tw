# Article content collection

Article bodies are private indexing inputs. Public article APIs, search results,
reader lists and personal RSS publish a short plain-text summary and the original
link. A stored full body is never an authorization to republish it.

## Source order and rules

Each verified blog receives a persisted extraction-rule record, including blogs
that have no observed articles yet. `pending` and `no-posts` do not mean a fetch
succeeded. Platform inference selects shared WordPress, Blogger, Pixnet, Medium,
Substack, Vocus, Matters, Hugo/Jekyll or generic semantic HTML rules; an explicit
site rule can override the inferred selector without executing publisher code.
Manual rules must not be replaced by crawler inference.

The adapter and registry pattern selectively reuses the MIT-licensed tag project
at `afe0a65`; see NOTICE. News-specific minimum article length, freshness, and
publication-frequency assumptions are not reused. Short and image-only posts
remain valid. Explicit excerpts, paywalls, truncation and missing semantic bodies
remain distinguishable from complete content.

RSS `content:encoded`, Atom `content`, and already fetched public WordPress
`content.rendered` are retained separately from public summaries, without another
HTTP request. A missing or partial body can be supplemented by a publisher-owned
public platform endpoint or the article's HTML. WordPress endpoints are learned
from publisher markup and checked against the article owner. No private APIs,
authenticated content, robots blocks or access restrictions are bypassed.

Owner-path platforms remain deliberately conservative. An opaque Matters `/a/`
or Vocus `/article/` URL does not by itself prove the author of a profile feed.
Until publisher-owned author evidence establishes that mapping, these URLs are
rejected as unresolved ownership rather than merging everyone on the platform.
Platform selector fixtures establish extraction behavior, not proof that every
real-world theme or author URL is supported.

## Storage and consumers

Additive migration `0011_content_evidence` creates per-blog rules, per-article
body snapshots, and bounded attempt metadata. Snapshots include source kind/URL,
completeness, source and observation timestamps, adapter/rule revisions, body hash,
and failure/deferral state. A worse partial observation cannot silently replace a
previous complete body. Re-ingestion is idempotent.

Relationship analysis and vocabulary matching consume the same body snapshot,
so one successful fetch can support both. HTML-page link positions and syndicated
body-only coverage remain distinct. Search reads internal text but returns only
bounded snippets; its response explicitly states the limited indexed window.

Public provenance endpoints are `/api/content/coverage` and
`/api/blogs/<slug>/content`. They expose counts, source/status and timestamps,
never stored bodies or extraction selectors. Responses have bounded single-flight
caches to avoid repeated aggregation under concurrent page visits.

## Operations

`BLOG_CONTENT_ENABLED=true` enables the isolated BullMQ `blogs-content` job;
it is disabled by default. `npm run content:once` runs a bounded batch. The job
shares the relationship lease, per-origin and global HTTP budgets and page budget,
not a second independent allowance. Each actual request follows the existing
robots, identifiable User-Agent, delay, DNS-pinned public-address validation,
redirect validation, timeout and response-size rules. A batch handles at most
five articles with a two-minute wall-clock bound and resumes remaining work later.
Budget exhaustion is a deferral, not evidence that a blog failed.

HTML pages may be parsed up to the existing 8 MiB HTTP response limit; the
selected body is then limited to 128 KiB of text and 256 KiB of HTML. Large
headers or scripts do not consume the stored article-body allowance. Adapter
`blog-content-v2` prioritizes retrying older incomplete HTML observations marked
`content-limit`, within the same budgets. A version change alone does not refetch
complete RSS/API evidence. Previously truncated history payloads still require
a fresh article-page fetch to recover their omitted content.

Before release, back up the formal database and apply only the additive migration.
Validate real SQL ingestion, public summary boundaries, platform fixtures,
idempotence and budget behavior against the disposable port-18169 database.
Build from the pushed `origin/main` commit and switch only the blog services.
Rollback keeps the new additive tables, disables `BLOG_CONTENT_ENABLED`, and
removes the blog-only content scheduler before selecting the previous release.

Frontend changes in this stage are implemented by Claude Opus 5.5 in an isolated
worktree; Codex checks the diff, runs `npm run test:web`, typecheck and production
build, and verifies native browser screenshots before the final handoff. Asset
generation uses the existing repository tool, not a separate design pipeline.

Review outcomes for this release include strict article identity across HTML,
sitemap and history redirects (including meaningful query IDs), preservation of
partial evidence through fetch failures, preference for complete syndicated/API
content over weaker HTML extraction, and adoption of inferred site rules only
from accepted complete evidence. Failure writes follow the same blog-then-post
lock order as feed ingestion. Stable excerpts/paywalls/content limits back off
for 30 days. Private review packets and model responses remain ignored by Git.
