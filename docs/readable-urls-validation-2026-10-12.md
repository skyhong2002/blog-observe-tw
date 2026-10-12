# 可讀網址預覽驗證（2026-10-12）

**尚未部署。** 正式版本仍為 `d6fd44a35da4ac92052e04bff670c6c161e50b3d`；本批以使用者指定草稿 `249bbc7` 與遠端 `origin/main` 的 `a1a226d` 為基礎。

最後容量檢查約 9.2 GiB，低於 10 GiB 門檻，停止建置與部署；不另行清理任何檔案。先前已依使用者本人批准，只刪除 `blog-completion-release`、`blog-icon-fix` 中的六個依賴／建置目錄，df 可用空間當時由 10G 增至 12G。

## 已完成驗證

- 623 個後端測試、151 個前端測試、23 組隔離 SQL suites（18 migrations）通過，TypeScript 與文件一致性檢查通過。共用主機高負載時有既有爬蟲／圖片測試逾時；維持相同測試與安全期限、改最多兩個測試 worker 後全部通過。
- 中文路由用 Next 自己的 matcher／dynamic-param fixtures 回歸測試；真 HTTP 大寫 escape 回 200，小寫 escape 一次 301，雙重編碼、斜線、反斜線及未知頁回 404。
- 下列每組在隔離 gateway／Next 預覽實测舊網址 301 一跳到新網址 200，且新頁 canonical 指向自己。這不是正式站驗收結果。
- 首頁、部落格頁、話題頁 metadata／JSON-LD 驗證通過；未新增薄頁 noindex 門檻。
- 新 gateway＋舊 d6 web 的相容回滾實測兩個新網址 200、舊網址 301；限制見 `docs/seo.md`。
- 最新 API 回應檢查 50 個部落格：url 為本站、sourceUrl 與原站 DB 值一致、favicon 保留、不含 pageUrl。

## 單跳網址样本

| 舊網址 | 新網址及 canonical | 結果 |
| --- | --- | --- |
| https://blog.observe.tw/blogs/discovered-fa86bb6d78428551e7fc/ | https://blog.observe.tw/blogs/nicechord.com/ | 301 → 200 |
| https://blog.observe.tw/blogs/discovered-4303cd7a22dc54dbefae/ | https://blog.observe.tw/blogs/alexhsu.com/ | 301 → 200 |
| https://blog.observe.tw/blogs/discovered-cd64fa80683aa545affd/ | https://blog.observe.tw/blogs/blog.nudoragon.com/ | 301 → 200 |
| https://blog.observe.tw/blogs/discovered-45d93ed29dd2efd31d0f/ | https://blog.observe.tw/blogs/blog.ikukaroom.com/ | 301 → 200 |
| https://blog.observe.tw/blogs/discovered-6c8961b49b2d47294c55/ | https://blog.observe.tw/blogs/yoe1.bearblog.dev/ | 301 → 200 |
| https://blog.observe.tw/topics/tag%3A0007a8e4ac46ea23807630a1c90b8cbc9a65fea91e963298298edae989cda47f/ | https://blog.observe.tw/topics/%E8%B3%87%E8%A8%8A%E5%AE%89%E5%85%A8/ | 301 → 200 |
| https://blog.observe.tw/topics/tag%3A002d36cd17f1fa1f74fa505bc3eb75eed63ff07f083b4e552333eecbc54aafcf/ | https://blog.observe.tw/topics/%E7%8D%A8%E6%97%85/ | 301 → 200 |
| https://blog.observe.tw/topics/tag%3A003e6674d0fe2cf600019d7c5d89d2cfc7c277b182135a1997aa020a4131ace6/ | https://blog.observe.tw/topics/%E5%89%AA%E5%88%80/ | 301 → 200 |
| https://blog.observe.tw/topics/tag%3A005bdf908478268f230cbf219b56de6bc9c4b728006b99752b947109505bc877/ | https://blog.observe.tw/topics/%E8%A7%A3%E8%AC%8E/ | 301 → 200 |
| https://blog.observe.tw/topics/tag%3A0060b3495778f9564829a135b365bc4d2a635003bea144ecdd2a60b2035122fc/ | https://blog.observe.tw/topics/%E7%B5%B1%E4%B8%80/ | 301 → 200 |

## 預覽 sitemap

| 子檔 | 筆數 | 檢查 |
| --- | ---: | --- |
| https://blog.observe.tw/sitemaps/pages.xml | 5 | 全部新網址；各抽三筆 200／自我 canonical |
| https://blog.observe.tw/sitemaps/blogs.xml | 313 | 全部新網址；各抽三筆 200／自我 canonical |
| https://blog.observe.tw/sitemaps/topics.xml | 3259 | 全部新網址；各抽三筆 200／自我 canonical |

這些數量取自同步中的預覽資料；正式切換後需重新擷取並回報。候選、文章與詞庫持續更新，不能把不同時間的筆數差異歸因於薄頁政策。

## 尚待容量恢復

1. 重新 fetch origin，確認包含本批最新提交，先檢查至少 10 GiB；不再建立完整備份。
2. 重建 `/api/`：最新使用者批准了 v1 blog.url 語意變更，頁面從同一份 `data/openapi.json` 產生，須把最新規格編進正式 artifact。
3. 合併 main／push，建立不可變 release，切換 blog 服務，保留回滾。
4. 重跑 `tools/seo/verify-readable.ts`、兩個 SEO 驗證器及三站／healthz／OAuth／SSRF 檢查；回報正式 commit、十組 301 與 sitemap 筆數。

## 審查與容量

前端由 claude-opus-5-5 CLI 實作；Codex 負責後端與交叉審查。有效 review 為 Codex 66／Opus 23，約 2.87:1；兩次截斷 Opus 回應未計入。採納 Unicode 真 HTTP、回補完成閘門與 301 相容回滾；不採納 302 過渡（違反使用者單跳 301 指示），也不加入未核准的薄頁門檻。

本 worktree 可重建依賴約 687 MiB、建置輸出約 170 MiB，全部保留。15:35 UTC 完整備份 632,440,263 bytes 已保留；未壓縮舊 helper 已停用。今後僅破壞性變更／刪除前做串流 gzip 備份，估算完成後仍需至少 10 GiB。
