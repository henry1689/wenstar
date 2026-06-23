/**
 * package-flagship — 旗舰版打包脚本
 *
 * T4: 主程序 + 太虚图书馆后端一体化打包。
 * 默认开启知识库，首次启动自动初始化目录。
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'dist', 'hermes-flagship');

function copyRecursive(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = join(src, f);
    const d = join(dest, f);
    if (statSync(s).isDirectory()) copyRecursive(s, d);
    else if (f.endsWith('.js') || f.endsWith('.d.ts') || f.endsWith('.js.map')) copyFileSync(s, d);
  }
}

console.log('=== 太虚境 旗舰版打包 ===\n');

// 1. Compile main project
console.log('[1/5] 编译主程序...');
execSync('npx tsc', { cwd: ROOT, stdio: 'pipe' });

// 2. Compile library
console.log('[2/5] 编译太虚图书馆...');
execSync('npx tsc', { cwd: join(ROOT, 'lib/taixu-library'), stdio: 'pipe' });

// 3. Copy main output
console.log('[3/5] 复制主程序产物...');
copyRecursive(join(ROOT, 'dist'), join(OUT_DIR, 'dist'));
copyFileSync(join(ROOT, 'start.cjs'), join(OUT_DIR, 'start.cjs'));
if (existsSync(join(ROOT, 'src/webui/index.html'))) {
  copyFileSync(join(ROOT, 'src/webui/index.html'), join(OUT_DIR, 'index.html'));
}

// 4. Copy library output
console.log('[4/5] 复制太虚图书馆产物...');
copyRecursive(join(ROOT, 'lib/taixu-library/dist'), join(OUT_DIR, 'lib/taixu-library'));
// Also copy node_modules for library
const LIB_NM = join(OUT_DIR, 'lib/taixu-library/node_modules');
if (!existsSync(LIB_NM)) mkdirSync(LIB_NM, { recursive: true });
const libDeps = ['mammoth', 'pdf-parse', 'tesseract.js'];
for (const dep of libDeps) {
  const srcPath = join(ROOT, 'node_modules', dep);
  if (existsSync(srcPath)) copyRecursive(srcPath, join(LIB_NM, dep));
}
// Copy library package.json
copyFileSync(join(ROOT, 'lib/taixu-library/package.json'), join(OUT_DIR, 'lib/taixu-library/package.json'));

// 5. Create unified package.json and startup
console.log('[5/5] 创建整合配置...');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const allDeps = { ...pkg.dependencies };
writeFileSync(join(OUT_DIR, 'package.json'), JSON.stringify({
  name: 'hermes-flagship', version: pkg.version + '-flagship', type: 'module', private: true,
  dependencies: allDeps,
  scripts: {
    start: 'node start.cjs',
    'start:library': 'node lib/taixu-library/index.js --port 3737',
  },
}, null, 2));

// Create startup wrapper that auto-launches library
writeFileSync(join(OUT_DIR, 'start-with-library.cjs'), `/**
 * 旗舰版启动器 — 自动拉起太虚图书馆后端
 */
const { spawn } = require('child_process');
const path = require('path');

process.env.TAIXU_LIBRARY_ENABLED = 'true';

// Start library subprocess
const lib = spawn('node', [
  path.join(__dirname, 'lib/taixu-library/index.js'),
  '--port', process.env.TAIXU_LIBRARY_PORT || '3737',
], { stdio: 'pipe', detached: false });

lib.stdout.on('data', d => process.stdout.write('[Library] ' + d));
lib.stderr.on('data', d => process.stderr.write('[Library] ' + d));
lib.on('error', () => console.log('[Library] 启动失败，主程序继续运行'));
lib.on('exit', code => console.log('[Library] 进程退出 code=' + code));

// Start main server
require('./start.cjs');
`);

// Environment template
writeFileSync(join(OUT_DIR, '.env.example'),
  'DEEPSEEK_API_KEY=your_key_here\nTAIXU_LIBRARY_ENABLED=true\nTAIXU_LIBRARY_PORT=3737\nPORT=3000\n');
writeFileSync(join(OUT_DIR, 'start.bat'),
  '@echo off\nnpm install --production\nnode start-with-library.cjs\npause\n');

console.log(`\n✅ 旗舰版打包完成: ${OUT_DIR}`);
console.log('   启动: cd dist/hermes-flagship && npm install && node start-with-library.cjs\n');
