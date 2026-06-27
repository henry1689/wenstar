#!/usr/bin/env node
/**
 * 太虚境·WebUI 启动器
 * 在 tsx 启动前加载 .env 到 process.env，确保所有 import 的模块能读到环境变量
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 加载 .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key) process.env[key] = val;
  }
  console.log('[Start] .env 已加载');
}

// 启动 server.ts
const child = spawn('npx', ['tsx', 'src/webui/server.ts'], { shell: true,
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=6144' },
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
