/**
 * 太虚境 · 生产环境静态服务器
 * 手机公网模式专用
 * 支持: 静态文件 + /api/ 反向代理到 3001 + /audio/ 反向代理
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5174;
const DIST = __dirname + '/dist';
const API_TARGET = { host: 'localhost', port: 3000 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  const url = req.url;

  // API 代理
  if (url.startsWith('/voices') || url.startsWith('/voice') || url.startsWith('/engine')) {
    const ttsOpts = {
      host: 'localhost',
      port: 8765,
      path: url,
      method: req.method,
      headers: { ...req.headers, host: 'localhost:8765' },
    };
    const ttsReq = http.request(ttsOpts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    ttsReq.on('error', () => { res.writeHead(502); res.end('502'); });
    if (req.method !== 'GET' && req.method !== 'HEAD') req.pipe(ttsReq);
    else ttsReq.end();
    return;
  }

  // API 代理
  if (url.startsWith('/api/') || url.startsWith('/audio/')) {
    const opts = {
      host: API_TARGET.host,
      port: API_TARGET.port,
      path: url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${API_TARGET.port}` },
    };
  const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => { res.writeHead(502); res.end('502'); });
    if (req.method !== 'GET' && req.method !== 'HEAD') req.pipe(proxyReq);
    else proxyReq.end();
    return;
  }

  // 静态文件
  let filePath = DIST + (url === '/' ? '/index.html' : url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(DIST + '/index.html', (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`✅ 太虚境生产服务: http://0.0.0.0:${PORT}`);
  console.log(`   手机访问: http://100.111.83.52:${PORT}`);
});
