# Proposal: traffic-source fields in tag's shared Similarweb result

Blog currently consumes only the loopback authenticated API. The validated contract
contains monthly visits, rankings, category and top countries, but no traffic-source
shares or referring domains. Blog therefore displays only observed incoming blog
links and the existing traffic summary; links are **not measured visits**.

Requested optional, backward-compatible additions to `traffic`:

- `trafficSources`: nullable `{ period: 'YYYY-MM', direct, referral, search, social,
  mail, display }`, with each share nullable, finite and between 0 and 1. Do not
  infer missing values as zero or normalize an incomplete total to 100%.
- `referringSites`: nullable array of `{ domain, share: number | null }`, bounded to
  20, normalized public domains only. State whether shares refer to all traffic
  or referral traffic using `shareBasis: 'all' | 'referral' | 'unknown'`.
- Per-field source period and existing `fetchedAt` / `source` provenance. Null means
  unavailable; an empty known result must be distinguishable from a missing field.

Tag owner should extend its existing provider payload sanitizer, stored sanitized
result and internal result response/tests, without adding provider requests or
increasing the shared global budget. Exact files should be selected by tag's thread
against its current branch. Blog will validate optional fields and hide unavailable
sections. No public provider payload or service token is exposed.

Risks: provider field names/units may vary or be absent, samples can be sparse, and
referral sources are not necessarily blogs. Verify real sanitized fixtures before
shipping. Rollback: omit the optional fields; old blog/tag clients continue to work.
This is a proposal only; no tag files or schedules were modified.
