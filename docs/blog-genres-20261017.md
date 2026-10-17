# Blog genres and reader contributions

## Scope and evidence

This follow-up supersedes the initial heuristic classification in
[Article reader filters](article-filters-20261017.md). All 455 verified blogs in
the 2026-10-17 export receive 1–3 AI labels, with 848 assignments in total.
These are provisional judgments, not author declarations or a measure of quality.
The homepage is unchanged; `/articles/` still defaults to unlimited per blog.

`tools/export-blog-genre-evidence.ts --output evidence.json` exports only verified
blogs, with identity, URL/domain, description, existing category, up to 15 latest
public post titles, and the top 15 public feed categories among those posts with
distinct-post counts. It uses one connection and sequential batches of 25 blogs;
every SELECT has a five-second statement limit. Blog and category bounds fail
closed rather than silently truncating the catalog. It made no production writes.

The AI read the evidence in batches, assigned labels using language judgment,
and revisited ambiguous cases against additional sampled titles. In particular,
JavaScript design patterns are programming, not visual design; miniature artwork
using food materials is not a food review; a software-download site is technical,
not automatically a hardware-review site. A mixed blog can have up to three labels.
`programming` includes software usage, digital tools, self-hosting and engineering;
`culture` includes books, language, music, film and literature; `creative` includes
photography, illustration and visual design; `life` includes personal health and
fitness writing. These broad boundaries deserve reader feedback.

`data/blog-genre-seed.json` retains all exported evidence alongside each label's
English reason, confidence, `source: ai` and `labelledAt: 2026-10-17`. No page body
or external website verification was performed. Counts reflect collected feed
metadata, not every article a site ever published. `other` is a deliberate fallback
for insufficient or non-editorial evidence, not proof that a site has no subject.
New blogs added after the run can remain unclassified and are always retained by
genre filters. All labels are provisional; "high" means stronger sampled evidence,
not independent confirmation.

## Vocabulary and coverage

Assignments overlap, so counts do not sum to 455. There are no unclassified blogs
in this export; 11 receive `other`, and 16 blogs have low-confidence judgments.

| ID | Reader label | Blogs |
| --- | --- | ---: |
| `food` | 美食 | 66 |
| `travel` | 旅遊 | 85 |
| `gadgets` | 3C／科技產品 | 33 |
| `programming` | 程式／技術 | 168 |
| `life` | 生活／日記 | 203 |
| `parenting` | 親子 | 15 |
| `news` | 新聞／媒體 | 15 |
| `finance` | 財經 | 24 |
| `anime` | 動漫／遊戲 | 59 |
| `culture` | 閱讀／藝文 | 107 |
| `creative` | 攝影／設計 | 62 |
| `other` | 其他／綜合 | 11 |

The old `blogs.category` coverage remains 124/455 (27.3%), with 331 `待分類`.
The previous frequency observation remains: 289 blogs had no collected posts in
seven days, 128 had 1–7, 19 had 8–21, 15 had 22–70, and 4 had at least 71.
Among the 166 active blogs, median was 3 and P90 was 22 posts. This supports an
optional display cap without requiring genre labels or judging publishing frequency.

The initial heuristic assigned 105 blogs; 350 additional blogs now have labels.
Of the original 105, 63 have a changed label set and 42 retain the same set.
`data/blog-genre-disagreements.json` records every changed set, independently of
runtime resolution. The original `data/blog-genre-review.json` and
`data/blog-genres.json` remain historical comparison artifacts only; the gateway
no longer imports either. Important corrections include saydigi's gadgets label,
Nash's food-focused coverage despite a broad travel category, and technical
personal blogs previously missed without repeated RSS categories.

## Twenty spot-check examples

Reasons below summarize each blog's reviewed seed evidence; the JSON contains
all source titles, categories, confidence and per-assignment reasons.

| Blog | AI labels | Reason |
| --- | --- | --- |
| 電腦王阿達 (`kocpc`) | 3C／科技產品, 新聞／媒體 | Hardware reviews, consumer electronics launches and technology news dominate recent posts. |
| 波比 (BobbyFun) (`bobbyfun-248`) | 旅遊, 美食 | Accommodation and destination guides alongside repeated market and restaurant food guides. |
| 阿榮福利味azo (`azo-307`) | 程式／技術 | Software downloads, utilities and operating-system tools rather than hardware reviews. |
| Nash.tw 神之領域 (`nash-tw-312`) | 美食 | Restaurant and street-food reviews; all fifteen sampled posts use food-review categories. |
| 電腦玩物 (`seed-390`) | 程式／技術 | AI productivity workflows, software applications and digital tools. |
| dietician江欣樺 營養師 (`dietician-396`) | 其他／綜合 | Dietitian-branded commercial site, with no collected articles or feed categories to establish a narrower genre. |
| upssmile.com/ (`upssmile-com-492`) | 美食, 旅遊 | Recent posts are cafe and restaurant visits; broad repeated design categories do not establish a design-focused blog. |
| 哇哇 ez3c (`ez3c-657`) | 程式／技術 | Windows utilities, AI coding software and digital-asset downloads; the 3C name alone overstates hardware coverage. |
| 點子生活 saydigi (`saydigi`) | 3C／科技產品, 旅遊, 程式／技術 | Recurring wearables and appliance coverage, travel guides and AI software; the sparse category heuristic missed this mixed technology publisher. |
| 好和弦 - NiceChord.com (`discovered-fa86bb6d78428551e7fc`) | 閱讀／藝文 | The sampled posts overwhelmingly teach music theory and performance; one pitch tool does not establish a software genre. |
| Shuyu Pixelart (`discovered-e8ba63c638ea166a97cc`) | 攝影／設計, 生活／日記 | Pixel-art creation and monthly personal retrospectives. |
| Huli's blog (`discovered-3565128083e8a6200b10`) | 程式／技術, 生活／日記, 財經 | Programming teaching and a JavaScript book, personal reflections, and a sustained retirement and investment series. |
| 伊果的沒人看筆記本 (`discovered-2101e3a9264ca64b78a7`) | 程式／技術, 生活／日記, 動漫／遊戲 | C# and .NET tutorials alongside personal notes and games. |
| 安娜的自我探索與成長筆記 (`discovered-007369fa080b7f30cf87`) | 生活／日記, 程式／技術, 攝影／設計 | JavaScript design patterns, personal writing and visual creation. |
| MINIATURE CALENDAR (`discovered-64fb8dd21ea4dc680f94`) | 攝影／設計 | Miniature-art photographic compositions; food-labelled objects are artistic material, not restaurant reviews. |
| Web Graphics (`discovered-ac47350e04a53d63531c`) | 程式／技術, 財經 | Current titles concern AI training and side-income advice rather than the historical graphics identity; domain content may have changed. |
| CCSX Makes ACG NEWS 支店 (`discovered-f8ce1216316d75e55b28`) | 動漫／遊戲, 新聞／媒體 | Recurring anime and manga industry news. |
| にゅーあきばどっとこむ (`discovered-c67c86dff8e1a1d51a13`) | 動漫／遊戲, 新聞／媒體 | Japanese anime, manga and related release reporting, including adult-oriented works. |
| Jerry Yang's Blog (`discovered-8f2bab490eff9cc2219c`) | 程式／技術, 生活／日記 | Kubernetes, GPU and kubectl engineering notes with annual reflections. |
| WANcatServer (`discovered-c60cc1e318cc0d6b11f7`) | 程式／技術, 生活／日記, 閱讀／藝文 | Homelab networking and collaborative systems alongside personal fiction and reading. |

## Least certain: review queue

These 16 low-confidence sites should be checked by a human or their authors.
Empty commerce/test feeds do not justify guessing a narrower label from a brand.

| Blog | Labels | Why uncertain |
| --- | --- | --- |
| dietician江欣樺 營養師 (`dietician-396`) | 其他／綜合 | Dietitian-branded commercial site, with no collected articles or feed categories to establish a narrower genre. |
| 好味小姐 (`seed-937`) | 其他／綜合 | Only test-titled posts are collected; the brand identity alone is insufficient for a narrower evidence-based genre. |
| Haha Baby (`haha-baby-1047`) | 其他／綜合 | Apparel-commerce metadata but no collected posts or categories to establish a more specific editorial genre. |
| 小時脆脆 trytwo (`trytwo-1108`) | 其他／綜合 | Clothing-commerce site with no collected posts or category evidence. |
| chennchenn.com (`chennchenn-com-1118`) | 其他／綜合 | Clothing-commerce metadata without collected editorial evidence. |
| Wa Cookie (`wa-cookie-1133`) | 其他／綜合 | Commercial brand URL with no collected posts or feed categories; name alone is not sufficient to infer food coverage. |
| Bessieu (`bessieu-1146`) | 其他／綜合 | Commercial site with no collected posts or genre-specific category evidence. |
| celesteterry.com.tw (`celesteterry-com-tw-1150`) | 其他／綜合 | Commercial site with no collected posts or genre-specific category evidence. |
| yuyu-active.com (`yuyu-active-com-1152`) | 其他／綜合 | Apparel-commerce metadata without collected editorial evidence. |
| Justkid (`justkid-1178`) | 其他／綜合 | Apparel-commerce metadata without collected editorial evidence; the name alone does not establish parenting content. |
| Web Graphics (`discovered-ac47350e04a53d63531c`) | 程式／技術, 財經 | Current titles concern AI training and side-income advice rather than the historical graphics identity; domain content may have changed. |
| GreasePocket Blog (`discovered-acdf91fa3becd9fa15f8`) | 其他／綜合 | Only project-name and About titles are collected; insufficient evidence for a confident technical assignment. |
| Empty2333的雜物收納空間 (`discovered-774939e5ecaae3aa7a62`) | 閱讀／藝文 | Only one literary-work title is collected; classification is tentative. |
| 內外之間 - Lina 形象教室 (`discovered-a496f5502e68815f9f71`) | 生活／日記 | Only one reflective daily-life article; image-consulting name is insufficient to infer a broader design focus. |
| 雪榕 From Taiwan (`discovered-01d4afaa13319e4bca6a`) | 生活／日記 | Only one personal blogging-reflection entry is collected. |
| Maoyue Blog (`discovered-af66be2aeda781efd6ac`) | 生活／日記, 程式／技術 | Only a website-restoration post is collected; technical and personal labels are tentative. |

## Storage and resolution

`0029_blog_genres.sql` creates only:

- `blog_genre_assignments`: `blog_id`, `genre`, `source` (`ai`, `admin`, or
  `community`), `status` (`active`, `candidate`, or `hidden`), a reason, optional
  actor user ID, and creation/update timestamps. The primary key is
  `(blog_id, genre, source)`: the admin override is separate from the AI baseline
  and community candidate, so releasing it cannot destroy the baseline.
- `blog_genre_votes`: `blog_id`, `genre`, `user_id`, `vote`, `at`. Primary key
  `(blog_id, genre, user_id)` guarantees one current opinion per reader. A CHECK
  constrains the stored value to -1 or +1; withdrawal deletes the row. The
  `(blog_id, genre, vote)` index supports scoped count reads.

The schema and `meta/0029_snapshot.json` describe these tables; the journal has
entry 29. Migration generation also noticed existing 0027/0028 schema changes;
those already-owned table/index statements were removed from 0029. There are no
production migration applications or writes in this work.

Each genre resolves independently:

1. Admin `active` forces display; admin `hidden` forces hidden. Counts still update.
2. Without an admin override, an AI `active` label displays when agrees >= disagrees
   (including zero/zero). More disagreements hide it.
3. Without an AI baseline, a community candidate displays at net agrees >= 2.
4. Releasing the admin override deletes only the admin row, immediately restoring
   the baseline/vote result. It never deletes opinions. Admin actions also preserve
   a community candidate for a newly introduced genre, so releasing an admin-only
   label immediately applies its accumulated opinions.

This follows the candidate/vote/admin-release pattern of tag.observe.tw picture
votes (`/home/deck/Projects/tag.analysis.tw`, read from `origin/main`), adapted to
multiple independent genres rather than a single winning picture. `other` remains
an independent label; adding a specific community label does not silently remove
it. An admin can hide it or readers can disagree.

## Reads, writes and UI

The overview resolves all sources in the latest 200 posts with one additional
query (at most 200 unique verified slugs and 2,400 known blog/genre combinations).
It aggregates assignment states and indexed per-blog/genre vote counts with
`SET STATEMENT max_statement_time=1 FOR`. The blog detail uses the same read for
one slug. No label JSON is used as a runtime fallback. A failed read, including
missing migration, yields `genreStatus: unavailable` / `genreState.status:
unavailable`; articles still render, genre controls are disabled, URL preferences
are retained but not applied, and the per-blog display cap still works. A new or
unlabelled blog is a successful empty classification, a different state. A source
whose labels are all voted hidden also has no displayed genres; the article count
therefore says "no displayed genres" rather than calling it unclassified.

Public DTO additions are optional for older gateways. `/api/overview` adds
`genreStatus` and optional post `blogGenres`; `/api/blogs/:slug` adds optional
`blog.genreState` with candidate status, source, counts and override. User IDs,
individual opinions and actor IDs are never included in public genre DTOs.
Older gateways without a readiness field also leave genre exclusion unavailable.

The blog-page genre block shows AI/reader/admin provenance, counts, and explicit
shown/not-shown status. Hidden and pending candidates remain inspectable so votes
can restore them. Signed-out readers get a login prompt; signed-in readers can
agree, disagree, withdraw or propose from the 12-value list. Admins can set, hide
and release. The browser fetches private state only after session identification;
SSR renders the public block without reading cookies into the public page.

Private routes:

- GET `/api/me/blog-genres/:slug`: own votes, actual admin capability and a
  session-bound, genre-specific HMAC CSRF token.
- POST `/api/blogs/:slug/genres/propose`, `{genre}`: create a community candidate
  and agree atomically, including if the same genre has an AI baseline.
- PUT `/api/blogs/:slug/genres/:genre/vote`, `{vote: 1|-1|0}`: change or withdraw.
- PUT `/api/blogs/:slug/genres/:genre/admin`, `{action: set|hide|release}`.

Every write requires `requireUser`, the exact same Origin and the session's CSRF
header; rejects unknown keys/genres; marks responses private/no-store; and has a
shared per-user 30/minute write allowance across these endpoints. A bounded
in-process map limits memory (10,000 active user windows; fail closed at capacity).
The allowance is per gateway process; a multi-process deployment would need a
shared counter. Existing gateway IP limits also apply.

Writes lock the verified blog row in a transaction. Admin capability is rechecked
against the pinned Google identity inside that transaction; each admin operation
writes an audit entry. Proposal and opinion upserts are idempotent. The public
result is re-read after commit; if that read fails, the write still reports
success with an unavailable genre state rather than inviting a duplicate retry.

## Applying reviewed labels

Only run after review, against the intended database, after applying migration 29:

```sh
node --env-file=/path/to/target.env tools/apply-blog-genres.ts --dry-run
node --env-file=/path/to/target.env tools/apply-blog-genres.ts --apply
```

The dry run makes only time-limited SELECTs with one connection; it reports
matched/skipped verified slugs and makes no writes. Apply locks each matched blog,
upserts only the AI source and removes that blog's obsolete AI genres. It preserves
all community/admin rows and opinions; unchanged reruns retain the same label,
reason and seed-date timestamps. Slugs no longer verified are skipped. Blogs
absent from the seed are not changed; a later export/review must classify new ones.
The file validator rejects duplicate slugs, invalid labels, empty reasons and
missing assignments before opening the database. The old heuristic proposal tool
is historical and does not produce this version-2 reviewed seed format.

The seed labels have not been imported into production. Deploying the code before
migration leaves genre reads explicitly unavailable; applying migration without
seeding leaves blogs unclassified. These are distinct, visible states.

## Validation and remaining decisions

A disposable `mariadb:11.4` container (384 MiB limit, 64 MiB buffer pool, one CPU,
loopback-only port) ran the final migration and 455 synthetic blog rows. Dry-run
matched 455 without writes; repeated applies yielded 848 AI assignments. Sixteen
real-DB assertions exercised AI ties/hiding, opinion replacement/withdrawal,
community thresholds, admin set/hide/release, audit entries and preservation of
admin choices/votes on seed reapply, including release of an admin-introduced
genre. The DB CHECK was also exercised against an
invalid vote. The container was removed afterward. No production schema or data
was changed. This validates the new migration in isolation, not the entire old
migration history or a real production login in a browser.

Final checks:

- `npm run typecheck`: both gateway and web passed.
- Biome on changed supported files: 25 files, no fixes or errors.
- `npx vitest run --maxWorkers=4`: 136 files / 1,395 tests passed.
- `npm run test:topic-ui`: 12 files / 190 tests passed, including public and
  signed-in genre-block SSR, admin controls and unavailable-filter behavior.
- `npm run test:web`: 243 tests passed, including optional DTO validation.

The first unrestricted Vitest run had four existing timeout/CLI timing failures
and an overview fixture with a missing source slug that triggered the new bounded
read. The five affected files passed when rerun together (82 tests); missing
slugs are now excluded from genre reads. The full suite then passed with four
workers. The topic-writer registry was regenerated; only the new genre routes and
seed-tool entries were added. No unrelated writer entries changed.

Product choices that remain adjustable: the net-two community threshold, whether
one net disagreement should hide an AI label, the broad software-tools boundary
of 程式／技術, and the names of the two combined arts genres. Defaults stay unlimited,
and the homepage remains unchanged. Human review should start with the low-
confidence queue and mixed-topic sources; complete seed coverage is not proof
that every genre is correct.
