# Relationship discovery quality controls

This supplements [blog-relationships.md](blog-relationships.md). Crawling and
automatic admission can be paused independently with `BLOG_RELATIONS_ENABLED`,
`BLOG_AI_ENABLED`, and `BLOG_CANDIDATE_REVIEW_ENABLED` without stopping reader
pages, feeds, or historical article collection.

## Evidence and identity

The semantic link parser uses full class tokens and stops link classification at
the article body boundary. Layout classes such as `right-sidebar`,
`ast-no-sidebar`, and `tag-movie-comment` do not make the whole article a sidebar
or comment. Sharing widgets, related-post blocks, and tag-cloud links are excluded.
Comments, sidebars, blogrolls, and body links keep separate provenance.

Platform identity is an author subdomain or explicit owner path/query, never the
platform root. Matters, HackMD, Note, Substack profiles, and Gamer owner pages join
the existing Blogger/WordPress/Medium/Vocus rules. Unresolved shorteners and known
media, social, shopping, or aggregation destinations retain a reason on the raw
observed link and do not consume candidate creation budget. Short URLs are not
automatically followed solely to create a candidate in this release.

AI personal-blog classification uses only a versioned set of website-owned
site-name, description, and explicit introduction excerpts. Generated prompt labels,
article text, and visitor comments are not ownership evidence. Every positive
personal classification quotation must be found in one allowed excerpt and itself
contain a personal self-introduction. The gateway, cache consumer, and admission
writer validate the proof separately. RSS/sitemap identity, URL ownership, daily
admission limits, and depth limits still apply. Old-policy AI results cannot authorize
new admission. Ambiguous evidence remains unresolved.

## Shared upstream and malformed data

Vocabulary sync prefers `http://127.0.0.1:18130`, serially, at least 500 ms between
requests. Only a connection failure permits the fixed public fallback, at least
1100 ms apart. Public requests may carry `x-service-token`, read from the private
owner-owned mode-600 `~/.config/observe-tag/blog-token`; local requests carry none.
Missing/unsafe token files fall back to the anonymous policy without logging the
credential. Redirects cannot forward that credential elsewhere. Both paths count
against the blog's conservative 100-wire-request daily budget, regardless of the
upstream service allowance. 429 respects bounded `Retry-After` and durable deferral.

Malformed labels are skipped individually, with bounded diagnostic samples and
counts preserved in the snapshot manifest and shown in coverage information.
A malformed article/window/cursor schema terminates that run with a cooldown;
it cannot permanently hold the oldest scanning cursor. The last complete published
snapshot remains available until another complete snapshot is ready.

## Cost and freshness

The worker precomputes bounded relationship graph snapshots for 7/30/90 days.
A shared database revision fences concurrent rebuilds against administrator
corrections. Public graph reads use those snapshots and bounded single-flight
caches; per-blog queries scope their source set before aggregation. Topic queries
scope publication dates and the selected blog before joining keyword evidence,
with a bounded 120-second single-flight cache. API rendering never calls tag.

Link reconciliation has a due-time index and compiles publication aliases once per
batch. An exhausted origin is checked before reserving another article attempt;
budget-delayed work is deferred, not reported as a source failure. Previously
successful evidence remains available across transient delays. Parser-version
repair preserves raw observations and re-fetches under the same safety limits,
without accepting an old conditional 304 as proof of a new parse.

A reference percentage is the target's distinct referring articles divided by
all observed **article × known target-blog** pairs from the referring blog.
One article mentioning three blogs contributes three denominator pairs. Unknown
targets are excluded. This is neither the proportion of all articles nor traffic.

## Required deployment checks

1. Fetch `origin/main`; build and verify an immutable release from its pushed commit.
2. Run `npm test`, `npm run typecheck`, `npm run lint`, and the web build.
3. Run `npm run test:integration -- --env-file /path/to/private-clone.env` against
   loopback port **18169**. The runner creates and drops a random disposable database,
   applies baseline plus additive migrations, blocks external HTTP, and tests actual
   SQL concurrency, budgets, admission, link replacement, visibility, snapshots,
   vocabulary recovery, and administrator authorization. Never pass production env.
4. Back up `blog_observe` before additive migrations. Verify isolated gateway/UI,
   then switch the three blog services; keep rollback release and unit backups.
5. Verify formal homepage, `/healthz`, OAuth S256/callback, admin anonymous
   302/API401, proxy SSRF rejection, and tag/youtube HTTP 200.
6. Re-enable bounded discovery only after parser, ownership, and SQL validation.
   Inspect real batch outcomes and coverage; do not fabricate edges or reset daily
   budgets merely to make a demonstration look complete.
