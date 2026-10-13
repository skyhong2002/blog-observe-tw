# Guarded web build

Root機器內部核准檔位於 `.reviews/guarded-build/`：owner本使用者、mode0600、非symlink、<=4KiB。欄位 kind=`root-approved-web-build-v1`、cwd=fresh detached project worktree canonical路徑、sha=40hex、estimatedGiB=新增大檔估算、expiresAt=UTC、gatewayInternalUrl固定 `http://127.0.0.1:18175`。執行 `node tools/guarded-build.mjs <approval-json>`；不是再向使用者問permission。

Source HEAD/tracked及未忽略untracked必須乾淨；main與child都確認web/.next不存在，拒release/temp/tmp，不刪既有artifact。nice19→ionicec3→detached受控child先等待GO；parent核pid/pgid/session/startTicks/ppid且重新資源gate後才GO。Child再驗自己的receipt，取得host單一participant flock FD槽 `/home/deck/.cache/observe-build-0.lock`，才固定執行repo tools/build-web.mjs完整npm build/postbuild/standalone paircheck，整個pipeline同PG。CIRCLE_NODE_TOTAL=2（Nextcpus1）、RAYON_NUM_THREADS=2、UV_THREADPOOL_SIZE=2，gateway僅green18175，不預設active18160；不接受任意shell/command。

全站（blog、tag、遠端 youtube 主機）同時最多一個 build。本站以單一 flock slot 限制 participating runner；既有本機 Next/Docker/buildctl 按 PGID 去重，start 或 monitor 排除 own 後 >=1 即閉鎖。遠端 youtube 不在本機 /proc 範圍：root 核准與啟動前必須人工協調並確認其他主機沒有 build；本機 process 掃描與 flock 不能證明跨 host 排他。未參與的 Docker daemon／遠端 jobs 也不受此鎖原子控制，proc 無法讀取即 fail closed。

Start `/home`>=40GiB且扣估算仍>=40；runtime<30GiB/load1>12則STOP。固定 blog 完整 HTTP HTML <=6170ms，tag/YT 各 <=2000ms，final200與complete body，不把103/TTFB冒充整頁。不下載其他資源。資源每1秒，homepage約每10秒，開始/成功結束必測；資源已bad不再probe。

暫停時只SIGSTOP經receipt驗證的own negative PGID。早期identity失敗NO GO，關control pipe後child不能啟build；已GO後controller EOF只讓child自停其已建立PG。Child保留已flock的open-file-description/FD，因此全PG暫停與parent退出皆不釋slot；無autoCONT。Parent detach unref child與stdinpipe，完成private JSON後可退出。Paused artifact記ownerUID、runnerPID、ownPID/PGID/startTicks；若identity不能證明，parent不signal其他process，而關控制pipe/failed讓operator處理。

JSON只記固定reason/SHA/數值gate/固定三站標籤/owned receipt，不記headers/body/env/token/build stdout或stderr。最多100事件＋總採樣數，新的mode0600 wx artifact不覆蓋舊run。Build stdout/stderr仍ignore；若build failure需由root另行受控診斷，勿宣稱此log是完整compiler trace。

本輪僅離線mock：`node --test tools/guarded-build.test.mjs` 13pass、Biome pass；沒有真build/probe/capture/DB/真flock-SIGSTOP整合。握手、單slot/FD、低資源不start、owner失敗noGO、PGID/PID reuse、paused不CONT與pipe unref已mock。依最新 relative gate，blog 完整首頁 >6.17 秒或 tag/YT 任一站 >2 秒即禁止新 build 與新 capture；不得只看 TTFB。Root 必須重新確認三站、磁碟、load 與跨 host 人工協調，並完成獨立 review 後才可啟動。先前已開始的 build/capture 可完成，已完成的 4cc7bcd 產物保持原樣；本次只修改後續工具，不重建或變更 runtime。

Baseline：UTC 2026-10-13T05:47:30Z–05:48:30Z，curl DNT:1、Accept:text/html，各站5次、間隔3秒，取完整HTML time_total中位數；blog 3.085s／tag 0.256s／youtube 0.289s，max(2s,2×baseline) 為6.17s／2s／2s。來源 `/tmp/babysit/gate-baseline-receipt.md`；工具與新receipt共用 `homepage-gate-baseline.mjs`。這不是瀏覽器全部資源的load，也不是TTFB。

Baseline 的 DYNAMIC time_total 包含來源站渲染、Cloudflare edge 與網路，不能當作精確的來源站渲染時間。
