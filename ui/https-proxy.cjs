/**
 * HTTPS 反向代理 — 将 https://192.168.10.114 转发到 Vite (端口5174)
 * 使用 mkcert 签发的证书
 */
const https = require('https');
const http = require('http');
const fs = require('fs');

const options = {
  key: fs.readFileSync(__dirname + '/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert.pem'),
};

const TARGET = { host: 'localhost', port: 5174 };

https.createServer(options, (req, res) => {
  const proxyReq = http.request({
    host: TARGET.host,
    port: TARGET.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => { res.writeHead(502); res.end('Proxy Error'); });
  req.pipe(proxyReq);
}).listen(443, () => {
  console.log('HTTPS proxy running on https://192.168.10.114');
  console.log('iPhone Safari 访问: https://192.168.10.114');
});
