# 話題正文的 owner guard

`ac8c04b` 只在共用 `topicBodyJoins` 加上 `cb.blog_id=p.blog_id` 與
`o.blog_id=p.blog_id`。原 CASE、current selector、legacy/window freshness、公開日期與
no-store 不變。正文 hash 相同不能覆蓋 owner 不符；這不是 article/source URL 或
canonical 的完整 provenance 驗證。

Source／mock 通過非作者 Sol 與 Opus 5.5 審查。既有 18169 隔離服務的 disposable schema
通過 25 migrations／28 checks：same-owner golden、foreign owner／post transfer 但 hash
不變、own relation fallback、owner 修回、實際 ranking／history SQL、frequency coverage
predicate、window batch rematch、NULL 日期與 orphan body。另 9 組 F3/F4 SQL 回歸通過。

Opus 的 N2、N3 已採納：單獨測 body-only history freshness，且要求 fixture 的 corpus
先為空，避免 limit-one batch 挑到別篇。N1 的共用 frequency predicate／drift check 與
N4 其他 caller 完整 SQL 驗證留給 D1；沒有把複製的 coverage predicate 說成跑了完整
frequency refresh，沒有把 source／SQL 說成正式 Next／RSC 驗收。

## 部署前的 operator 診斷草稿

**尚未在正式資料庫執行，正式影響量未知。**下面先以 indexed ID keyset 限定 50 筆，
再分類 mismatch，輸出只有 next cursor／counts。prepared query 將 last_cursor 綁兩次；
一批不是發生率估計。遇 250ms timeout 停止／延後，不擴大 query 或增加 batch 預算。

```sql
SET STATEMENT max_statement_time=0.25 FOR
WITH bounded_ids AS (
 SELECT id FROM posts WHERE id>? ORDER BY id LIMIT 50
), sampled AS (
 SELECT ids.id,
  (cb.post_id IS NOT NULL AND cb.blog_id<>p.blog_id) cb_mismatch,
  (o.post_id IS NOT NULL AND o.blog_id<>p.blog_id) relation_mismatch
 FROM bounded_ids ids JOIN posts p ON p.id=ids.id
 LEFT JOIN content_post_bodies cb ON cb.post_id=p.id
 LEFT JOIN relation_observations o ON o.post_id=p.id
)
SELECT COALESCE(MAX(id),?) next_cursor,COUNT(*) sampled_rows,
 COALESCE(SUM(cb_mismatch),0) cb_owner_mismatches,
 COALESCE(SUM(relation_mismatch),0) relation_owner_mismatches
FROM sampled;
```

暫時失去有效 body hash 的 legacy index 會等待既有有界 batch rematch，標題的 history
證據仍可保持 fresh。不得以 `body_hash IS NULL OR ...` 放寬 reader 來補 coverage。
新 full generation 的 marker、持久 provenance／fingerprint、dirty barrier、CAS、
writer/history/carry adoption 仍未完成，因此 full publication 維持 hold。

本批没有建置、capture 或正式 probe／部署。正式仍最後確認的 green/gen5 `4cc7bcd`；
候選需在 Mint 同一份產物重新執行 B0，再取得獨立 UI review 與正式驗收。
