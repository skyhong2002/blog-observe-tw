# Guarded web build

Root機器內部核准檔位於 `.reviews/guarded-build/`：owner本使用者、mode0600、非symlink、<=4KiB。欄位 kind=`root-approved-web-build-v1`、cwd=fresh detached project worktree canonical路徑、sha=40hex、estimatedGiB=新增大檔估算、expiresAt=UTC、gatewayInternalUrl固定 `http://127.0.0.1:18175`。執行 `node tools/guarded-build.mjs <approval-json>`；不是再向使用者問permission。

Source HEAD/tracked及未忽略untracked必須乾淨；main與child都確認web/.next不存在，拒release/temp/tmp，不刪既有artifact。nice19→ionicec3→detached受控child先等待GO；parent核pid/pgid/session/startTicks/ppid且重新資源gate後才GO。Child再驗自己的receipt，取得host兩個participant flock FD槽 `/home/deck/.cache/observe-build-{0,1}.lock` 之一，才固定執行repo tools/build-web.mjs完整npm build/postbuild/standalone paircheck，整個pipeline同PG。CIRCLE_NODE_TOTAL=2（Nextcpus1）、RAYON_NUM_THREADS=2、UV_THREADPOOL_SIZE=2，gateway僅green18175，不預設active18160；不接受任意shell/command。

每host最多2個participating builds；既有Next/Docker/buildctl按PGID去重，start>=2或monitor排除own後>=2即閉鎖。兩slot只協調參與runner；不能宣稱所有非參與Dockerdaemon/遠端jobs已被原子控制，proc無法讀取即failclosed。不同同時build應使用不同freshcwd。

Start `/home`>=40GiB且扣估算仍>=40；runtime<30GiB/load1>12則STOP。固定blog完整HTTP HTML<=6000ms、tag/YT各<=2000ms，final200與complete body，不把103/TTFB冒充整頁。不下載其他資源。資源每1秒，homepage約每10秒，開始/成功結束必測；資源已bad不再probe。

暫停時只SIGSTOP經receipt驗證的own negative PGID。早期identity失敗NO GO，關control pipe後child不能啟build；已GO後controller EOF只讓child自停其已建立PG。Child保留已flock的open-file-description/FD，因此全PG暫停與parent退出皆不釋slot；無autoCONT。Parent detach unref child與stdinpipe，完成private JSON後可退出。Paused artifact記ownerUID、runnerPID、ownPID/PGID/startTicks；若identity不能證明，parent不signal其他process，而關控制pipe/failed讓operator處理。

JSON只記固定reason/SHA/數值gate/固定三站標籤/owned receipt，不記headers/body/env/token/build stdout或stderr。最多100事件＋總採樣數，新的mode0600 wx artifact不覆蓋舊run。Build stdout/stderr仍ignore；若build failure需由root另行受控診斷，勿宣稱此log是完整compiler trace。

本輪僅離線mock：`node --test tools/guarded-build.test.mjs` 12pass、Biome pass；沒有真build/probe/capture/DB/真flock-SIGSTOP整合。握手、兩slot/FD、低資源不start、owner失敗noGO、PGID/PID reuse、paused不CONT與pipe unref已mock。最新blog2.82052s在新6s限制內，仍須root fresh三站/磁碟/load完整gate及独立review後才執行，不能沿用舊2s判斷或單站觀測。
