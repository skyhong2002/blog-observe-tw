# B2 explicit body-prefix lexical overlap (source/mock only)

Existing profiles separate direct body links, non-body blogroll/sidebar/comment
links and native shared tags. Their `textSimilarity` is still `not-analysed`.
The new modules do not alter schemas, workers or that profile default.
An experimental internal GET `/api/relations/text-similarity?source=ID&target=ID`
accepts one explicit pair only when `BLOG_TEXT_SIMILARITY_ENABLED=true`; otherwise
it returns 404 without database access. It is not part of the v1 public contract.
`loadTextSimilarity` itself defaults off and only reads when its explicit `enabled`
option is exactly true. There is no automatic profile pairing or UI-ready claim.

Input is `{pairs:[{sourceArticleId,targetArticleId}],sourceBlogId?}`: at most ten
explicit pairs, at most ten total unique article IDs. Self-pairs and duplicate
unordered pairs are rejected. No automatic pairing, global search, database writes,
new table, producer or outbound HTTP request is implemented.

The pure method is set Sørensen–Dice over three-codepoint grams from the first4096
codepoints after NFKC/lowercase/whitespace collapse. Raw text is limited to64KiB.
Each side must have at least64 codepoints and eight distinct grams, else the result
is `insufficient-text` with a null score. `lexicalSimilarity` ranges0..1 only for
actual analyzed pairs. The version is `body-prefix-dice-trigram-v1`.

This is literal normalized-prefix overlap, NOT semantic similarity, plagiarism,
citation, dialogue or proof of interaction. Repeated boilerplate may inflate it;
frequency is not weighted. Context-dependent Unicode transformations and prefix
truncation limit recall. No cutoff is presented as ground truth. A zero can describe
a fully analyzed disjoint pair but never substitutes for unavailable or unanalysed.

The reader uses two fresh SQL statements over the same explicit IDs. Both rejoin
existing posts, verified current publication owners, nonfuture/unknown publication
dates and an ok currently owned body observed no later than server UTC. Original
post/article/source URLs must belong to the current publication (including path
boundaries). Both stored composite content revision and capped raw UTF-8 byte SHA (including BOM) must
remain unchanged; title, URLs, owner, publication date, source observation time
and the bounded public summary are also rechecked. The second query hashes only64KiB+one sentinel byte per requested
article, never globally or with a full-body LIKE/COUNT scan. Any missing, hidden,
rejected, moved, future, deleted, non-ok, changed or foreign evidence invalidates
that pair with `unavailable` and null; oversized/invalidUTF8 reasons remain explicit.

At most two admission slots are held, INCLUDING unresolved pool waits after the
1500ms caller deadline. Late connections do no SQL and are destroyed; poisoned
connections never return to the pool. Queries have MariaDB250ms and driver500ms
limits. There is no request cache/singleflight. Database failure rejects as
`text_similarity_unavailable`, never fake successful empty/zero.

Pure scoring results contain only scores/counts/truncation, never private prefix excerpts.
The reader projects an explicit allowlist. Both reads select LEFT(post.summary,4000);
preview uses publicSummary <=240, null is empty and never falls back to body.
Public output contains article IDs, public article URL/title/date, matchVersion,
source/target observedAt, lexicalSimilarity, prefix length/truncation and ≤240
codepoint sanitized public post-summary previews. `previewSource` and `contextSource`
are `post-summary`; `comparedContextSource` is `body-prefix`. The summary is not
evidence of every contributing shared gram and no private body prefix is exposed.
No content/source/text hash, raw body, source-fetch URL or private token is projected.
Per-pair `observedAt` is the latest of its actual source observations; `analysedAt`
is the explicit analysis clock. Undated articles retain publishedAt null. Existing
reader metadata is not reclassified as freshly fetched content.

Pure/mock tests cover exact/symmetric/disjoint values, normalization, low diversity,
limits, ownership/date/revision changes, public projection and retained pending
admissions. No formal DB, HTTP, build, capture or route feature enablement was
performed by the module author; these tests do not replace a real isolated SQL or UI/privacy review.

The root's existing isolated DB18169 fixture separately exercised real SQL:
public post-summary projection, no private-prefix output, BOM on both bodies,
seed/rejected/moved/future exclusion, and a barrier-held A read with a new B after
a committed withdrawal. It did not use sleeps or TTL. These synthetic inputs do
not demonstrate production coverage, cost or a new build's HTML/RSC behavior.

Title-only changes invalidate the pair, just like date/URL/revision changes; the
public projection cannot retain the first read's stale title. This reader is for
cross-publication relationships: currently public evidence from the same blog
returns `unavailable`, reason `same-publication`, with null lexicalSimilarity.
The pure string algorithm remains generic; no threshold or score formula changes.

The 1500ms deadline can reduce availability: admission is deliberately retained
until uncancellable underlying acquisition/query work settles. Timeout does not
release the slot to accumulate an unbounded number of outstanding pool waits.
This safety/availability tradeoff is explicit, not a promise of retry progress.
