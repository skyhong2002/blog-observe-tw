# 候選自動驗證與收錄

依使用者授權，高信心且具有 RSS／Atom 的候選可自動成為公開收錄站；不再要求使用者逐筆審核整批候選。這是獨立於 discovery 的驗證階段，部落卷推薦本身不當作官方身份證明。

## 核准條件

- 來源指向可辨識的 publication 首頁。文章、商品、分類、任意子頁、平台總站與社群服務連結保留候選及理由；不依任意路徑猜作者。
- 首頁可正常讀取，來源名稱的完整規格化文字與首頁 title／site name／author 一致，RSS 名稱亦一致。共用單字或部分姓名不夠；不因短文、少文或多年未更新而判 stale。
- RSS／Atom XML 有實際文章，channel／alternate link 與首頁身份相符，所有文章網址均在該 publication 範圍。排除留言 feed、空 feed、混合作者／跨站轉載 feed；僅有 sitemap 尚不符合此階段的自動核准門檻。
- 保留平台作者的子網域／路徑。網站搬家須有同一次安全抓取的 redirect 與完整名稱證據；寫入原網址別名，不把平台總站或同筆名作者跨站合併。
- 所有網路請求沿用 robots、公開 DNS 釘選、每跳 URL/IP 檢查、識別 UA、每站延遲、大小與 timeout 限制；403／robots 不繞過。

## 交易與續跑

驗證過程不持有資料庫交易。核准時才開短交易，重新檢查候選狀態、人工稽核、已拒絕身份、URL／feed 所有權；新 blog、primary／redirect URLs、feed、候選狀態與稽核一起提交。既有 verified 站只關聯候選，不覆寫站名或作者資料；不轉移其他站擁有的 feed。

人工決定永遠保留。未通過者仍是 candidate，機器判斷保存於 `source_evidence.automaticReview` 與 append-only audit，管理頁顯示原因。低信心不自動拒絕。明確 SQL deadlock／wait timeout 最多重試兩次，每次重讀交易狀態；其他錯誤保留待重試，不虛報核准。

批次用 blog 專屬 named lock；網路前後皆確認 lease，成功釋鎖才歸還連線，失敗銷毀連線。pool 至少兩條：一條批次 lease、一條短交易。依已檢查時間與 ID 選下一批，七天內不重抓同一政策版本的失敗候選；新候選優先。每批有筆數及時間預算，個別請求仍受 timeout 限制。

```sh
# 預覽：不寫入 evidence／audit，也不設定七天重試門檻
node --env-file=/home/deck/.config/blog-observe.env tools/review-candidates.ts --limit 25 --minutes 10
# 使用者已授權的高信心自動收錄
node --env-file=/home/deck/.config/blog-observe.env tools/review-candidates.ts --apply --limit 25 --minutes 10
```

原始 CSV、研究報告、完整 review packet 與候選診斷留在私人 runtime／`.reviews/`，不提交 Git。正式批次前備份並以隔離 MariaDB 還原測試核准冪等、搬家別名、人工狀態、feed ownership、audit 失敗回滾與 seed 原始列不變。
