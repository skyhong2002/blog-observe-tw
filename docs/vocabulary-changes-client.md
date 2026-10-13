# 詞庫 changes：唯讀 client 與切換界線

本批基底 `00d0501`、目前 source 接續 `8edbf12`。上游契約依本機 immutable Git object `a89908a650c42a1224d657e6c908d5fd3c7be5a0` 的 snapshots／v1 source，不當成正式相容性證據。

`HttpSnapshotChangesSource` 預設 disabled，明確 enabled 才讀。首次 request固定after／cursor0，回應驗full或delta generation後pin target／完整opaque metadata digest；續跑以after、target、cursor精確URL，先驗persisted pin再fetch。不自動stage、補整份、排10分鐘job或改current。固定loopback／publicfallback、服務token與既有序列化間隔／Retry-After維持；2MB decompressed頁上限未放寬。

upsert沿用原詞條exact-label ID與原JSON驗證；格式字元在derived匹配去除，不改raw source ID。absent-from-index不是刪除crowdsource池，更不是撤銷blog文章證據或SEO頁。409回need-full-rebase並retainCurrent；429保留精確nextAttemptAt、有界重試；不合法JSON／超bytecap／contract永久failed，未知network unavailable，不保存raw error／token。

## 缺少的跨世代證據

上游changes()把多個世代的changePages攤成一個cursor序列，response snapshot只有target generation。target的changeCount／changePages不是整條chain的目錄，不能用來假裝全部世代count/checksum已驗。現在client只標 `integrity=per-page-checksum`、`chain=unverified`、`completeGeneration=false`、`cutoverAllowed=false`；頁面hash是provider回的自我checksum，並非已獨立pin每個中間世代catalog。

後續需要tag owner確認或提供版本化chain receipt（各generation ID/parent/base、hash/count、flatten頁到原generation/page的對應、總pageCount），或等價可驗證契約；blog不自行改tag。在此之前，這個read-onlyclient不把delta發布為current。不能clone473萬完整pool每10分鐘；後续应boundedoverlay＋generation／watermark原子提交、每日full對帳、409保留lastgood後有界rebase。

## Review與測試

兩個既有非作者Sol分別review purecontract與rootclient。採納兩P2：JSON持久化pin的null-prototype差異不能被當成身份差異；null/array/primitive wire須永久failed。新增serializedpin續跑和RetryAfter3600回歸。root3suites37mocks通過；沒有HTTP／DB／build／capture／正式啟用。

原報告：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/snapshot-changes-contract-independent-review.json`；client複審：`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/snapshot-changes-client-review/rereview.json`。兩份作者／review transcript paths、model與source hashes留在私有artifact；不是cutover或全量import完成。
