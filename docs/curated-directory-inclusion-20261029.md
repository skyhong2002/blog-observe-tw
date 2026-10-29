# Human-curated directories qualify directly (2026-10-29)

Base: `origin/main` at `7426054d82cf88afcac29161e8ee0bee42bd9406`.

IndiePing and BlogBlog's direct members are trusted for catalog qualification. Homepage language, personal-blog heuristics, missing RSS, HTTP failures and different feed titles do not cancel that qualification. Article ingestion still requires real articles belonging to the publication; a catalog entry does not assert that HTTP or content ingestion succeeded.

## Source boundaries

- IndiePing: read only `GET https://indieping.giveanornot.com/api/blogs`. Never use per-domain application endpoints. The current official response contains 312 domains.
- BlogBlog: first-column members in the `/blogrollroll/` table, plus named hosts and participants on `/party/`. Resource links, references, member blogroll links and arbitrary outgoing article links do not inherit this trust. Repeated participation is deduplicated by publication home.
- The first live read yields 404 normalized publication identities (425 URL variants, including www aliases). Two Vocus article-only links are resolved through each exact article’s structured salon declaration; mismatched article/salon IDs or unavailable pages stay unresolved for a later retry. No platform-wide identity is inferred.

Membership proof records the official source URL, membership kind, original link, publication home, retrieval time and response SHA-256. Candidate lookup includes both URL and source type, matching the database’s composite unique key. A legacy `source_type` or `directoryListing` alone cannot authorize this writer. Sync is additive: a failed source or disappearing link never automatically removes a publication.

## Admission and content

Admission uses the ordinary candidate-promotion named lock and a short transaction. It associates an existing publication or creates its catalog entry, alias, relation provenance and audit atomically. It preserves explicit decisions on that publication home, owner exclusions, non-verified existing records and conflicting identities. An old article/blogroll URL rejected for not being a homepage does not reject its publication home. It does not fabricate homepage checks, feed sources or posts. Public routes are registered after admission.

A bounded content queue runs every five minutes; official lists sync daily. Content discovery uses existing RSS/Atom/sitemap and generated-scraper machinery, with an independent 1,500-request daily budget and the shared per-host budget. Each site attempt has a 45-second/24-request ceiling so a broken host cannot hold up the queue. Failed sites wait a day before another content attempt. Missing content is eligible for scraper repair immediately instead of waiting fourteen days; scraper activation makes the content queue retry promptly. Existing repair quotas and cooldowns remain in effect.

The public queue distinguishes catalog admission from content: article count, articles pending, or article fetch awaiting repair. Actual post counts are read at response time, so subsequent successful normal crawls are reflected correctly.

Operator entry point: `node --env-file=<private-config> tools/sync-curated-directories.ts` is read-only; add `--apply` for catalog sync, or `--content --apply --limit 25` for bounded content ingestion. `--output <new-private-file>` retains detailed results. No schema migration is required.

## Verification and rollout

The isolated MariaDB suite covers real catalog transactions, source outages, preserved exclusions, existing publication association, public routes before content, English/no-feed/403 members, cross-site RSS filtering, retry backoff, audit-trigger rollback and concurrent admission. Parser tests cover official source boundaries. The topic-writer registry explicitly includes the new admission writer.

A private gzip backup of the full schema and affected catalog, membership, route, feed and scraper tables was taken before application. Article/body/topic data are outside that targeted backup. Deployment uses an immutable committed release, the inactive web/gateway slot and a single worker; the previous slot remains available for rollback. Detailed production results are recorded separately after rollout.
