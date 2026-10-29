# Curated directory rollout — 2026-10-29

Base: `7426054d82cf88afcac29161e8ee0bee42bd9406` (`origin/main`, fetched before implementation/build).
Deployed code: `e1025ed190c6a8b389ca54d901cd66f02dca0fdc`.
Production: blue, edge generation 114, https://weblog.tw/.
Previous green release `e5a877e8426ba68686f1c9ee259c62363b4434cf` remains running for rollback.

## Production result

Snapshot: 2026-10-29T08:59:40.692Z (UTC).

- 406 normalized direct-member identities qualified; 397 distinct existing/new blog records after known aliases are associated.
- 135 blog records newly created by this rollout.
- 292 blogs already have actual articles; 105 have no article yet (92 awaiting a content attempt, 13 attempted and waiting for retry/repair).
- 30017 actual stored articles across these blogs, including articles indexed before this rollout; this is not a new-article count.
- Zero unresolved source links, zero directory-fetch failures, zero held canonical members in the final official-list sync.
- Two Vocus article links were resolved to their declared salons through the exact article IDs and salon IDs in their structured page data.
- The initial 153 old homepage candidate rows matching qualified member identities were reconciled through the same audited admission writer, preserving their discovery evidence and human decisions. No matching pending homepage candidates remain. Raw article/blogroll URL rejections remain URL-specific and are not interpreted as a rejection of the publication home.

An actual repair was exercised for `https://blog.2broear.com/`: validated scraper 62, three real-page samples, then eight actual articles written. The initial feed returned successfully without useful articles; the final code ensures that this cannot suppress a validated repair for a curated publication with no feed-derived articles. Examples of newly admitted, crawled sites also include `blog.huli.tw` (20 articles) and `blog.darkthread.net` (10 articles).

Missing content does not revoke catalog qualification. The remaining content failures include HTTP 403, no usable source, empty results and fetch failures; they remain visible to the content and scraper-repair queues. A per-site or per-day budget can defer further attempts. These are not promises that every remote site is currently fetchable.

## Validation

- Full backend regression: 152 files, 1,482 tests passed (`--maxWorkers=4 --testTimeout=15000`; the initial default five-second timeout hit an unrelated cold application import, which passed alone and in the final full run).
- Frontend rendering: 14 files, 205 tests passed.
- Focused final crawl/scraper regression: 68 tests passed; curated validation/queue regression: 37 tests passed.
- Isolated MariaDB suite: all 36 migrations, real transactions, owner exclusions, same-URL/different-source rows, source outages, aliases, public routes, cross-site article filtering, audit-failure rollback, concurrent admission, retry backoff and repaired empty-feed behavior passed. External network is forbidden in that suite.
- Type checks, topic-writer registry, immutable standalone build verification and production HTTP/API checks passed.
- Public queue shows `blog.2broear.com` listed with eight articles; `blog.huli.tw` homepage rows are listed with 20 articles.
- OAuth S256 and the production callback are unchanged. Authenticated-only API still returns 401 without a session.
- One worker runs from the exact deployed immutable release, with scraper repair enabled, matching native Sharp dependencies and zero restarts during observation. Both web/gateway releases are healthy.

The schema is unchanged. A gzip-tested private backup of the full schema and affected catalog/membership/route/feed/scraper tables preceded application (SHA-256 `3090764e778e780925190a2c56efe00b07b8698dbf46f8adc09aae044af05a01`). Article/body/topic data were outside that targeted backup. Detailed JSON evidence and the per-site CSV are private operational artifacts under `.reviews/curated-inclusion/`; they contain public site metadata, not credentials.

This document is a receipt-only follow-up; it does not change the deployed application tree.
