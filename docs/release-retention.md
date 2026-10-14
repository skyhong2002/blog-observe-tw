# Release 與建置快取滾動保留

2026-10-14 UTC17:2x 使用者核准：應用 release 只保留目前正式版、一個可立即回滾版本，以及正在部署的候選。其餘舊版、失敗或中止的 release、建置暫存及快取可直接清理，不再逐次詢問。此政策取代歷史文件中的「所有 release 永久保留」。

資料庫備份、tag-backup、正式資料、一般 Git worktree 與原始碼不在清理範圍。`current`、slot、unit 或正在執行程序引用的目錄也不能刪。使用者另行核准 `~/.cache/blog-release-source-*` 中拋棄式 detached 建置 checkout 的清理；其他 worktree 不適用這個例外。

## 每次清理

1. 記錄 `df -h /home`、active.json、blue/green slot 和 ready descriptor。保留正式版、回滾版及正在部署中的候選。
2. 檢查 systemd unit/drop-in（包括已停用的舊服務）、edge/code、current/slot symlink、程序 cwd，以及其他 worktree 的依賴 symlink。被引用的目錄先保留；不要為騰空間停止正式服務或移除回滾能力。
3. 同既有部署工具使用 `edge/deploy.lock`，重新確認 active/slot 未變後，刪除未被引用的舊 release 及對應 `prepared-releases/<SHA>.json`、`build-receipts/<SHA>.json`。保留 active/slot/ready 和 transitions 歷史紀錄。
4. 拋棄式建置 checkout 必須沒有未提交原始碼、程序 cwd 或仍需要的依賴引用。使用 `git worktree remove` 更新 Git registry；不要直接刪一般工作目錄。私人 review 證據若只有這裡一份，先保存再清理。
5. 再記錄磁碟空間，確認 active、BUILD_ID、兩個 slot 的 /healthz、三站首頁及目前使用的原生模組正常。清理不做 migration，不建立新的完整資料庫備份，也不改 Cloudflare/WAF。

## 2026-10-14 實際執行

- 基底：fetch 後的 `origin/main`，`6f088caf44fe9f4b72a8f64899589ccf3beb36c2`。
- UTC17:44:20–17:45:26 移除 **18 個舊 release、4 個拋棄式建置 checkout、17 個對應 prepared/build JSON**，以及本批自己的過期 tmpfs 建置快取。
- `/home` 可用 **41.543 → 56.519 GiB**，使用率 **91% → 88%**；兩次 `df` 間增加 **14.975 GiB** 可用空間。這是磁碟量測差值，包含期間其他程序的寫入變化，不能當作逐檔精確加總。tmpfs 清理不計入 `/home` 的差值。
- 正式仍為 **blue／gen16／af0e73ccc3c5ace88dc8fb6f45d7d76123c218da**，BUILD_ID `LdOP5yqOhKdYbIlHZVfoN`。
- 回滾仍為 **green／76a90e7a4126832331761baca7c10d2133272b18**，BUILD_ID `1VV772sbyYBRdL9ur6l9f`。兩個 gateway/web 和 worker 都持續運作；沒有重啟服務或切換流量。
- 另保留 **93060cc5e97628f84fa1fb2b8e9eecc41157d462**（約 14 MiB）：`edge/code` 仍指向它，供 edge、slot launcher 和 active favicon job 使用。它是目前使用中的部署基礎程式，不是額外的應用回滾版；不能直接刪除。
- 保留 `blog-release-source-76a90e7…`：green ready descriptor 的 source 查驗和兩個開發 worktree 的依賴仍使用它。`blog-display-noise-20261014` 原本引用 43d 的兩個依賴 symlink 改指向 76a；根目錄與 web lockfile blob 完全相同，原始碼與 Git worktree 保留。
- 五份舊 unit/drop-in 中已被取代的 release 路徑改指向 af0。worker 的有效 WorkingDirectory/NODE_PATH 本來就是 af0，沒有更改有效功能旗標；舊服務和舊 favicon timer 維持 disabled。只執行 daemon-reload，未重新啟動它們。
- 清理後兩個 /healthz、三站各三次匿名 DNT GET 均 200；首頁完整回應時間中位數 tag **0.074s**、blog **3.224s**、youtube **0.119s**。active、slot、BUILD_ID 不變，active release 的 sharp 記憶體內 PNG smoke 通過。

私人原始紀錄：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/rolling-retention-20261015/`，含 plan.json、result.json、verification.json、unit 原設定和依賴 symlink 調整。舊 UI/B0 review、截圖、資料庫備份及一般 worktree 均保留；已清理的 release 路徑在歷史文件中只代表當時狀態。

立即回滾仍使用保留的同一份產物，不重新建置：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback green
```
