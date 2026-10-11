import http from "node:http";

const HOST = process.env.HOSTNAME || "127.0.0.1";
const PORT = Number(process.env.PORT || 18160);
const startedAt = new Date().toISOString();

const page = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>blog.observe.tw</title>
  <meta name="description" content="部落格觀察與閱讀入口">
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #0b1020; color: #eef2ff; }
    main { max-width: 860px; margin: 0 auto; padding: 12vh 24px; }
    .mark { width: 64px; height: 64px; border-radius: 16px; display: grid; place-items: center; background: #7c3aed; font-weight: 700; font-size: 24px; }
    h1 { margin: 28px 0 12px; font-size: clamp(2rem, 5vw, 4rem); letter-spacing: -.04em; }
    p { color: #b9c2dc; line-height: 1.7; font-size: 1.1rem; max-width: 680px; }
    .status { margin-top: 36px; padding: 18px 20px; border: 1px solid #293453; border-radius: 14px; background: #111a31; }
    .dot { display: inline-block; width: 9px; height: 9px; margin-right: 8px; border-radius: 50%; background: #34d399; }
    small { color: #8995b5; }
  </style>
</head>
<body><main>
  <div class="mark" aria-hidden="true">BO</div>
  <h1>blog.observe.tw</h1>
  <p>部落格觀察與閱讀入口正在運行。這個服務已接上 Steam Machine 的 Cloudflare Tunnel，後續可以在此加入部落格目錄、文章索引與訂閱功能。</p>
  <div class="status"><span class="dot"></span>服務正常<br><small>Origin: 127.0.0.1:${PORT} · started ${startedAt}</small></div>
</main></body></html>`;

function send(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url || "/", `http://${req.headers.host || HOST}`).pathname;
  if (path === "/healthz") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, service: "blog.observe.tw", port: PORT, startedAt }));
  if (path === "/") return send(res, 200, "text/html; charset=utf-8", page);
  return send(res, 404, "text/plain; charset=utf-8", "Not Found\n");
});

server.listen(PORT, HOST, () => console.log(`blog.observe.tw listening on http://${HOST}:${PORT}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
