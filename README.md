<img src="assets/icon.svg" width="64" height="64" alt="">

# blog.observe.tw

Created in [T3 Code](https://t3.codes).

## 第一版

目前服務使用 Steam Machine 上的 \`blog-observe.service\`，監聽 \`127.0.0.1:18160\`，由 Cloudflare Tunnel 提供 \`https://blog.observe.tw\`。第一版提供：

- 四個已核對的部落格 seed 目錄、分類搜尋、個別網站頁與原站連結。
- \`/healthz\`、\`/auth/me\` 與 Google OAuth PKCE 登入流程；callback 固定為 \`https://blog.observe.tw/auth/google/callback\`。
- 私有 OAuth 設定檔 \`/home/deck/.config/blog-observe.env\`，不提交到 Git，也不與 tag.observe.tw 共用服務設定。

完整的來源探索設計（\`blogblog.club\`、Similarweb Similar Sites、速率限制與和 tag 的協調方式）見 [\`docs/discovery.md\`](docs/discovery.md)。第一版尚未啟用自動 discovery、RSS 抓取、文章索引、持久化訂閱或完整 136 筆種子匯入。
