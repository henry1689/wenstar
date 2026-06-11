const http = require('http');
const TUNNEL_URL = 'https://emphasis-michel-align-vpn.trycloudflare.com';
http.createServer((req, res) => {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>太虚境 · 玉瑶</title><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="refresh" content="0;url=${TUNNEL_URL}">
<style>body{background:#0d0812;color:#f0e0e8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.card{background:#1c1530;border:1px solid #2a1e35;border-radius:12px;padding:30px 40px;max-width:400px}
h1{color:#e8a0b4;font-size:22px;margin:0 0 12px}
.btn{display:inline-block;padding:14px 32px;background:#4ade80;color:#000;border-radius:10px;text-decoration:none;font-size:18px;font-weight:700;margin:16px 0}
.url{color:#b8a0b0;font-size:11px;word-break:break-all;margin-top:12px}
.sub{color:#7a6a80;font-size:12px;margin-top:8px}
</style></head><body><div class="card">
<h1>🌙 太虚境 · 玉瑶</h1>
<p style="color:#b8a0b0;margin:8px 0">跳转到电话模式…</p>
<a class="btn" href="${TUNNEL_URL}">📞 打开电话模式</a>
<div class="url">${TUNNEL_URL}</div>
<div class="sub">支持4G/5G · 真正的电话模式</div>
</div></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(80, () => {
  console.log(`Redirect: http://192.168.10.114 → ${TUNNEL_URL}`);
});