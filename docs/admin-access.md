# Administrator access

The gateway protects `/admin/` and every `/api/admin/*` endpoint before the
Next.js UI proxy. Anonymous UI visitors are redirected to login; anonymous API
requests receive 401; authenticated readers receive 403. Encoded or ambiguous
admin paths are rejected. The UI only displays the management entry for an
effective administrator; it is not the authorization boundary.

## Verified identity and revocation

Set `BLOG_ADMIN_EMAILS` to a comma-separated list in the private service environment
file. No production account addresses or credentials belong in the repository.
On the first successful, verified Google login for an allowed email, the gateway
atomically pins that email to the Google `sub`, grants `users.role = admin`, and
records the change. A different Google account later presenting the same email
cannot replace the pin. Subsequent checks require the stored user/sub/pin and
current DB role; the pin's originally authorized email must remain in the configured
allowlist. An email change on the same Google account does not replace its pin.

To revoke or restore a previously pinned administrator from the trusted host:

```sh
node --env-file=/path/to/private.env tools/admin-role.ts USER_ID reader 'Reason for revocation'
node --env-file=/path/to/private.env tools/admin-role.ts USER_ID admin 'Reason for restoration'
```

The CLI checks an existing authorized pin before restoration and audits both
changes. Never delete identity pins to revoke access: removing the role persists
across later logins. Removing the original email from the allowlist also fails
closed. Existing sessions read the current role on every protected operation.

## Mutations and audit

`GET /api/admin/session` returns a session-bound CSRF token. Every management
mutation requires an exact configured `Origin`, `x-blog-csrf`, and a bounded
`idempotency-key`. An operation is reauthorized inside its write transaction;
network work is performed outside SQL transactions and rechecked before writes.
All admin responses use `Cache-Control: no-store`. Session values, API credentials,
and raw request headers are never recorded in audits.

The management pages share one row of tabs, each at its own URL:
候選來源 `/admin/`, 部落格 `/admin/blogs/`, 簡介與標籤 `/admin/overrides/`
(`?blog=<slug>` opens with that blog chosen), 連結關係 `/admin/relations/`,
Similarweb `/admin/similarweb/`, 帳號 `/admin/accounts/` and 稽核紀錄
`/admin/audits/`. They provide:

- Every blog in one sortable table (`GET /api/admin/blogs`): category, the genres
  readers see (admin-set or hidden ones marked), manual tags, a derived crawl state
  (正常, 久未更新 = no post in 90 days, 抓取失敗 = every feed failed 3+ times in a
  row with no generated scraper, 未抓到, 不收錄 = not verified), robots.txt, 7-day
  and total posts, and how many audited admin edits the blog had and the latest.
  The browser filters by crawl state, genre and category.
- Every signed-in account (`GET /api/admin/accounts`) with what it did: follows and
  API keys (互動), genre votes and admin edits (貢獻). Admin edits are counted from
  `admin_audits` by actor and grouped by action; the `.intent` rows, the
  bootstrap pin and Similarweb outcome rows are not counted. Edits made from the
  trusted-host CLI have no actor and count for nobody. Admins come only from
  `BLOG_ADMIN_EMAILS`, so the page shows roles but cannot change them.
- Candidate search, evidence, validation, approval, rejection, and batches up to 25.
  Approval still requires the personal-publication and RSS/sitemap checks, crawler
  safety, robots rules, ownership proof, and shared daily admission/network budgets.
- Blog profile or article topic overrides, explicitly separate from AI inference.
  Overrides cannot bypass candidate admission.
- Manual blog tags, preserving crawler and community provenance.
- Hiding/restoring erroneous observed links using a stable article/URL/location
  fingerprint. Original observations remain intact and refresh cannot shift an
  override onto a different link; public graph totals and evidence use the same filter.
- Similarweb requests through the existing tag-only loopback client and shared
  daily submission, scheduling, cooldown, and duplicate gates.
- Operation and role-change audits. URL relocation/merging remains a trusted-host CLI.

Global admin mutation budgets are 100/day, 60/day per administrator, and 20/day
for network intents, in addition to crawler/Similarweb budgets and gateway rate
limits. Repeating an idempotency key with another payload is rejected; a pending
operation is not silently rerun. If work or its final bookkeeping fails, its intent remains `pending` or
`uncertain`; it is never incorrectly marked as wholly rolled back. Inspect the
recorded intent, action audits, and upstream state before submitting a new operation
with a new key. Automatic lease reclamation is deliberately disabled because it
could duplicate an external request that already succeeded. External outcomes are
recorded against the existing authorized intent even if the actor is revoked
while waiting for the response; this does not authorize another mutation.

## Release and validation

Migration `0009_admin_identity_roles` only adds `users.role` and four admin tables.
Back up `blog_observe` before applying it. Validate against a disposable restored
copy first, then deploy the immutable commit already pushed to `origin/main`.
Previous application releases remain compatible with the additive columns/tables;
rolling back removes the new protected management functionality, so prefer a
forward fix for security changes. Do not restore a stale DB backup over new reader
or crawl data merely to roll back code.

Tests cover anonymous/reader/admin responses, CSRF and Origin rejection, permanent
sub pinning, revocation, mutation audits, SQL visibility filters, and preserved source
provenance. Formal production never receives fabricated Google users or sessions.
The final human check is a real Google login using each configured account, then
confirming the management entry and an audited operation.
