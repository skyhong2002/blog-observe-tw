# Shared vocabulary export: optional upstream deployment

Blog currently synchronizes the existing `/api/v1/articles` public contract with a
fixed one-day window and cursor pagination. Coverage is `observed-article-window`,
not a complete dictionary. Local published snapshots are immutable; a partial or
capped scan cannot replace the current version. Pages and article matching resume
through the isolated blog worker. Page rendering never calls tag.

The complete contract already exists in tag's `tag-vocabulary-export` worktree:
`app/src/v1/vocabulary.ts`, `app/src/vocabulary/snapshots.ts`,
`tools/vocabulary-export.ts`. The public production snapshot endpoint returned
404 on 2026-10-12. Tag's thread should review, commit and deploy those changes if
the user chooses full export. Blog does not modify tag's checkout or schedules.

Optional production enablement needs an immutable export directory, read-only
source DB identity, explicit publisher invocation/resource budget, API registration
and complete checksum/count validation. An exported snapshot covers all current
indexed article tags; it is still not a separately curated editorial dictionary.

Blog's existing snapshot client can then consume a pinned manifest and all pages,
validate per-page/full SHA-256 and exact UTF-8 term identity, and switch its own
current pointer in one transaction. Missing pages retain the previous version.
Test empty/oversized snapshots, partial retry, manifest mutation and historical
versions before switching from observed windows.

Rollback: stop publishing/disable the export endpoint while keeping immutable
files. Blog retains its last complete local version and explicitly reports its
coverage; no source terms, user sessions or reader data are modified.

Transport: production blog uses the fixed loopback tag origin at port 18130,
without forwarded client headers; at least 500ms between requests and concurrency
one. Public fallback uses at least 1100ms and bounded Retry-After backoff. This
reduces shared public rate-limit contention without increasing the crawl budget.
