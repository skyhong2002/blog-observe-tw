# 部署、分支與回滾

## 唯一整合分支

GitHub `skyhong2002/blog-observe-tw` 的 `main` 是整合與正式發版來源。本機主要工作目錄為 `/home/deck/.t3/projects/blog-observe-tw`，使用 `main`；不是 `.cache` 下的功能分支。

2026-10-12 收尾查核：GitHub main 原已包含 `06fa126`，本機 main 從 `696c39b` 以 `git merge --ff-only origin/main` 同步至 `06fa126`，未重寫歷史。`feat/tag-frontend-parity` 已完整納入 main；其 worktree `/home/deck/.cache/blog-frontend-parity` 保留作歷史比較，不再作開發或發版入口。

正式三服務已更新至 `/home/deck/.local/share/blog-observe/releases/9400b6a4a54fb0ae34ad22fd7158241cc63bc276`，由 fetch 後的遠端 main 乾淨 worktree 安裝、建置與驗證。前版 `4315a6ad713dcf37c74cfe0096b0d367e26bd3be` 與先前 `c09ddae4cce558e36af5e4404ca63713183ceefe` 及其四個服務 drop-in 內容保留供回滾。此次為種子網址驗證／文章來源收錄更新，詳見 [種子處理與部署紀錄](seed-resolution-2026-10-12.md)；早期版本見 [先前部署紀錄](deployment-2026-10-12.md)。

後續一般修改回到本機 main；多人並行時，先 fetch，再從遠端 main 建立短期功能分支／獨立 worktree。完成測試與 review 後合併回 main 並 push，才準備正式 release。不要對有未提交修改的共享 checkout 執行 pull、reset 或強制切換；保留現場，使用獨立 worktree。main 若分岔，先整合衝突，不以 force push 解決。

## 發版前檢查

先 `git fetch origin`。乾淨的本機 main 可用 `git merge --ff-only origin/main` 同步；有未提交變更時不執行該步。**不得從 stale main、功能分支的未合併 commit、工作目錄現有 node_modules 或舊 `.next` 直接發版。**

下列 Bash 範例固定遠端 main 的 SHA，建立 detached build worktree；任一步失敗即停止：

```bash
set -euo pipefail
cd /home/deck/.t3/projects/blog-observe-tw
git fetch origin
release_commit=$(git rev-parse origin/main)
# 驗證目前部署的程式已包含在本次發版歷史中。
deployed_directory=$(systemctl --user show blog-observe.service --property=WorkingDirectory --value)
deployed_commit=${deployed_directory##*/}
[[ "$deployed_commit" =~ ^[0-9a-f]{40}$ ]]
git cat-file -e "${deployed_commit}^{commit}"
git merge-base --is-ancestor "$deployed_commit" "$release_commit"
build_directory="$HOME/.cache/blog-observe-builds/$release_commit"
mkdir -p "$(dirname "$build_directory")"
git worktree add --detach "$build_directory" "$release_commit"
cd "$build_directory"
npm ci
npm --prefix web ci
npm test
npm run typecheck
npm run lint
npm run web:build
# 發版準備期间若 main 已更新，停止並從新 SHA 重建，避免覆蓋後續修改。
git fetch origin
test "$(git rev-parse origin/main)" = "$release_commit"
```

以上只準備建置，不自動切換服務。部署前再次核對 main SHA 與目前三服務的 release；同一時間只由一個維運者切換。祖先檢查防止部署舊版本，但不能偵測刻意 revert 的程式變更，仍須檢查 diff、測試與 review。明確的回滾走下節流程，不繞過檢查當作普通發版。

## release 與服務切換

- 每次建立新的 `/home/deck/.local/share/blog-observe/releases/<完整 commit SHA>`；由上述乾淨 worktree 複製同一 SHA 的 tracked files、安裝完成的 dependencies 與同次建置的 Next standalone，不覆寫正在使用的 release 或 `.next`。不複製 `.env`、CSV、review packet 或私人 catalog。
- Next build 的 postbuild 會把 `web/.next/static` 與 `web/public` 複製到 `web/.next/standalone/web/`，須完整保留。web 使用獨立 `/home/deck/.config/blog-observe-web.env`，避免 gateway `PORT` 污染 SSR。
- 在隔離埠驗證 gateway 18165、web 18166，檢查目錄、`/healthz`、OAuth 302／S256／精確 callback；涉及 DB migration 時先備份、還原演練，並記錄 DDL 的回滾限制。不得與其他 session 的 preview 搶埠。
- 保留原 drop-in 內容，再更新 `~/.config/systemd/user/<service>.service.d/20-frontend-release.conf`。gateway、worker、favicon service 的 `WorkingDirectory` 指向 release 根目錄；web 指向該 release 的 `web/.next/standalone/web`。daemon-reload 後重啟 blog web/gateway/worker；favicon 是 timer 啟動的 oneshot，不為切換 release 而強制觸發整批抓取。
- 正式 gateway 為 18160、web 為 18162；DB `blog_observe`、Redis 17379、queue `blog-observe-crawl`／prefix `blog-observe` 保持獨立。不得修改 tag/youtube 設定。
- 切換後確認三服務 active、blog 首頁與 `/healthz`、tag/youtube 均 200，OAuth 起始正確。記錄完整 SHA、先前 release、建置與驗證結果。設定檔、token 與 runtime favicon cache 位於 release 之外。

## 回滾

先依變更關閉有外部寫入的功能（目前為 `BLOG_SIMILARWEB_ENABLED=false`），重啟 blog worker；再把四個服務的 drop-in 指回已保留且通過驗證的完整 release，daemon-reload 並重啟 blog 三服務。保留新增資料表、候選、audit 與 runtime 圖示，不復活直接請求 Similarweb 的 client。切換失敗時恢復先前 drop-in，重新驗證三站。

**不要再用「刪除 release drop-in，回到原 checkout」作為快速回滾。** 原 main 已持續更新，ignored `.next`／node_modules 也不一定對應該 SHA；刪除 drop-in 可能混用新原始碼與舊建置物。`docs/frontend-parity.md` 和初期驗收紀錄中保留的這類描述僅是當時歷史狀態，已由本文件取代。

使用者指定的 `50d9d20` 舊架構基準與 `pre-skeleton-main`／`pre-skeleton-50d9d20` 標籤仍保留；舊 unit 備份位於 `/home/deck/.config/systemd/user/blog-observe-legacy-50d9d20/`。這是需要另建隔離工作樹、重新驗證相依套件／DB 相容性與舊 unit 的災難復原選項，不直接 checkout 或 reset 日常 main，也不把舊 unit 指向已更新的 main。現行安全修正不應因一般回滾被撤銷。
