# 首頁30詞、引用分組與共用標籤

基底origin/main b5e20b86d9250f83014a5a84e4e236e2f2582ea8。正式green/gen13/76a
已由babysit14:01完成1280/390驗收；本分支是下一批，尚未建置／部署。

首頁同一個view=home query讀30個品質篩選後的詞，items仍前8、cloudItems最多30。
兩consumer同路徑／request-scoped讀取，不另打tag上游或追加排行SQL。
正文引用仍flat8邊，前端按sourceBlogId+postId分卡，同標題不同ID不合併，
同文多網域各自保留anchor/context/date/version核對，跨方向不同文章不合併。

背景詞規則不增刪來源詞：當期符合tag broad3/2/3且長期基準至少3篇、
少於1/3命中文章的標題用此詞，就要求至少一個公開站的active crawler來源文章
標籤／分類明確使用同normalized_label，才進熱門排行。manual/community/hidden
標籤、identity角色／種類、撤下站與future文章不能提供此佐證；所有其他matched evidence/detail/
歷史頁／SEO集合不動。displayGate.v2與background.reason明記門檻；
唯讀topics:display-audit可查body-dominant-without-native-label-consensus。

實際唯讀preview100仍非空：人氣、傳承退出；門檻依使用者回饋由2站改為1站，景點的一站原始分類足以保留；美食、住宿、AI同規則。
正式唯讀preview 100詞：景點85篇、美食214篇、住宿80篇可進排行；人氣與傳承eligibleRankingPosts=0。
原始分類以normalized_label的SHA256一次分組／索引JOIN，避免逐詞重掃文章；
佐證只限topic角色與topic種類、active crawler來源。沒有為特定詞開例外，也沒追加通用詞黑名單。
原比例降權試算沒有充分移除人氣／傳承，僅留private實驗檔，沒有實作成正式規則。
分類佐證是排行展示品質，不把這些詞從crowdsource標籤池刪除或當無意義定論。

Opus非作者backend review B1/B3採納：全background排除仍保留policy-qualified
matchedPosts統計列；排序never-attempted/oldest-first避免失敗詞飢餓。
B2計數語意已明確：既有頻率規則的有效比對coverage，不是全部原始matcher rows；
高頻詞只有正文命中不在此數字，但原索引與歷史保持。MySQL/MariaDB使用COALESCE
1970日期並canonicalId tie-break，不照review的PostgreSQL NULLS FIRST建議改語法。
沒有OFFSET；eligible排序在LIMIT前，filtered items後才算truncated，不用含排除列
冒稱還有下一頁。原truncated review不計入，stop兩份原檔在ignored .reviews。

F1接線見shared-label-contract-offline.md。真人Google登入、F3歷史全文與全頁狀態
review仍pending。no-store、DNT、CF兩規則Disabled、HSTS86400不改，
既有release/回滾/備份/worktree全部保留。Code-only不新建全庫備份。

本批測試：backend 388項、Node 224項、SSR173項、TypeScript兩層通過；
隔離18169的home-display 4 suites（18品質SQL斷言、69關係斷言、6關係barrier、
11排行比較及6 fresh-read barrier）與B3 2 suites／47 checks通過。
獨立Sol source review三項P2均修正：LIMIT前套公開證據、audit整詞排除計0、
原始標籤topic role/kind。原測試與failed artifacts保留。
新候選尚待建置、B0與實圖review；不能據source review宣稱UI全部通過。
