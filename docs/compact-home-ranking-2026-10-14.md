# 首頁排行單次彙總

基底 origin/main 86318c851bc91a0b3885ab8c54d9c147682d00fb。f77 正式 gen14
後續三次首頁 median 6.188152 秒超過6.17，已UTC15:49:10回滾green76a/gen15。

home API原先 evidence/window_frequencies/排名層重複物化。現在一次按文章→詞→
部落格彙總，再以window functions保留每詞原始來源數，套相同tag broad3/2/3、
2% title-only、原始topic角色／種類標籤一站佐證、長期頻率及同站遞減權重。
首頁仍8排行＋30詞，沒有字詞例外、沒有修改詞池／比對版本／歷史／SEO集合。
所有verified／publication date／content hash／body hash／matcher version判定不變。
沒有跨請求快取、共享promise、TTL或Cloudflare改動。

正式DB同一唯讀交易、timezone Z、同now／30天的前30項，原方案3338ms、compact1445ms；
IDs、順序、篇數、站數、標題／正文篇數與score（容差1e-8）相符。
這是一次SQL比較，不能當正式HTML已達3秒。具體artifact在ignored
/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/home-cloud-b3/compact-readonly-parity-preview.json。
原早期preview用mysql2預設本地時區；以上timezone Z與正式pool一致，正式驗收以HTTP結果為準。

隔離18169 home-display4 suites（18品質SQL斷言、18查詢比較、6排行fresh-read barrier、
69關係斷言及6關係barrier）與B3兩suites47checks通過。386 topic tests＋TypeScript通過。
舊privacy/cap/fresh-read斷言都保留。獨立非作者gpt-6.1-sol source GO、raw log與四檔hash：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/compact-ranking-independent-source-review.json
SHA256 27fed862961a2f034bbe0be73ea0e497768a7abf6da1af35f9b6b7cc2adb94aa。

共用標籤背景選取改private producer一秒SQL上限（最多10詞）。公開validator/store
仍250ms；不改40/day budget或來源規則。實際read-only650ms回10詞。
一秒只是SQL執行上限，沒有宣稱包括pool acquisition／whole job。audit CLI timezone改Z。

前端與lockfile沒有變：web git tree 2cf3296b57a0a9906115b52a251a05385f1741f0，
root lock 9b84f40cad6ed90cb1532c7e2a8f496440b0211b，與f77完全相同。
候選會使用已建的f77 web產物（BUILD_ID LdOP5yqOhKdYbIlHZVfoN）與新gateway源碼，
明記webSourceSHA=f77a1fe43ccd5110e7982bfec07e997af4cb0e27，不假稱重新Next build。
新compose release的sourceArchive要逐檔驗證、53 barrier＋60 SSR/RSC再跑，
主要UI在候選actual capture/review，之後同產物切換。所有release/備份/worktree保留。
