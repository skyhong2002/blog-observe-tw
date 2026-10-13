# Partial local body search index (default off)

`BLOG_SEARCH_HISTORICAL_BODY_ENABLED` remains false until independent source review,
isolated SQL tests, explicit selected-body production indexing and real cost/privacy
validation. This change does not fetch articles, schedule workers, build or migrate
production. Migration 0023 only creates `post_body_search_terms` and its post index;
Drizzle schema and snapshot are synchronized. Previous releases ignore this table.

Bodies use NFKC then lowercase for BOTH posting construction and final literal
verification. This is not MariaDB accent-insensitive LIKE, stemming, ranking or
all-language full-text equivalence. A returned body snippet uses the same normalized
text and advertises `snippetNormalization`. Metadata preserves its existing SQL
LIKE semantics. Body queries shorter than three normalized codepoints explicitly
report `short-query`, never perform global LIKE.

A producer accepts at most ten explicitly selected positive unique article IDs:

```
node --env-file=<private-env> tools/index-search-bodies.ts --post-ids 20875
```

This is dry-run by default. `--apply` is a separate operator-authorized action after
0023, not something performed by this implementation or controlled by the public
search flag. It atomically clears only the selected post's old derived postings, even if its
new evidence is missing, non-ok, overcap, invalid UTF-8 or no longer owned. It
inserts replacements only from locked, currently public owned body evidence. No source posts, bodies or other tables are
removed. There is no content/worker hook in this batch. Therefore changed/new bodies
may be unindexed until explicit reindexing; stale content revision or text hash
never qualifies as a hit. Physical orphan index entries cannot expose deleted posts
because both candidate and final queries rejoin public live posts.

Input must fit 64 KiB UTF-8 and contain no lone surrogate. Invalid UTF-8 is
a per-post `invalid-utf8` producer status, not batch failure; readers skip only
that row and increment `invalidUtf8` coverage. Only the first 4096
normalized codepoints are indexed, with at most 4094 distinct three-codepoint hashes
per article. Oversized evidence is reported `overcap`, not truncated into a falsely
complete index. Source content revision is the extractor's existing composite hash;
an independent raw text SHA verifies text consistency. No comparison to feed/post
metadata hash is made. Hashes and raw body chunks never enter public DTOs.

The posting lookup selects at most 201 index-range candidates (including a sentinel).
At most 200 explicit IDs pass to the final SQL read. Final public/date/owner/status/
revision conditions and original URL ownership are rechecked. At most 64 KiB + one
sentinel byte per body is transferred; normalization and one text hash per returned
candidate happen in memory. The final reader does NOT regenerate thousands of gram
hashes per body. Each SQL statement has a 250 ms server deadline. No full body LIKE,
COUNT/GROUP sweep, cache or singleflight is used. Query failure is unavailable/503,
not successful empty. Missing index schema is explicit body `unavailable` alongside
metadata. Pool size/admission for public routes remains at most two active requests;
manual producer uses pool1, bounded acquisition, 500 ms driver query deadline and
5-second per-post destruction deadline. Producer failures stop without retries.

Coverage is always partial: indexed prefix only, unindexed population unknown,
short query, rejected/stale candidates, raw-byte overcap and 201-candidate truncation
are distinct. A common first gram may hide matches beyond 200; this is disclosed,
not replaced by an unbounded scan. Blog scoping applies before the candidate limit.
Metadata retains a maximum 1000 IDs in ingestion order, not publication recency;
older IDs can still match via the independent body posting set. There is no claim
that a zero result proves no match in all historical content.

Mock tests exercise normalization/byte limits, full-needle false positives, stale
text hash, URL ownership, candidate cap, absent schema, timeout, default-off, fresh
anonymous reads, bounded selection and transaction failure. `runSearchIntegration`
uses only the existing guarded ephemeral database fixture: old ID outside metadata
cohort, hidden/rejected/moved/future/deleted/current owner/status/revision checks.
These are synthetic inputs, not production content-cost or deployment evidence.

## Commit and normalization limitations

The per-post 5-second destruction deadline stays active during `commit()`; it is
not cleared to permit an unbounded commit. A network failure or deadline during
commit can make its result **unknown**: the server may have committed atomically
while the client reports failure. A rollback attempt cannot prove that commit did
not succeed. Do not automatically retry apply after such an error. Read the selected
derived rows and reconcile current source revision before deciding the next action.

The batch is a sequence of per-post transactions, not one whole-batch transaction.
A successful prefix remains committed if a later post fails. The CLI's bounded
error does not include those previous items, so an error is not evidence that no
index was written. Missing/invalid evidence itself is a successful per-post cleanup,
not a transient storage error. All deletion is limited to the selected post's
owned derived postings; source posts and private body evidence remain untouched.

NFKC and Unicode lowercase can be context-dependent (combining marks and Greek
final sigma). Applying them to an independent query may differ from transforming
its occurrence inside the full body. The index and final verification deliberately
share the same transformed-text substring semantics; they do not claim complete
original-text substring or case-insensitive linguistic recall. Results can be
partial for these cases; no algorithm rewrite or broad collation claim is made.
