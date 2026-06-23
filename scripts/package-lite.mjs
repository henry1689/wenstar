/**
 * package-lite — 轻量版打包脚本
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'dist', 'hermes-lite');

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

console.log('=== 太虚境 轻量版打包 ===\n');
console.log('[1/4] 编译主程序...');
execSync('npx tsc', { cwd: ROOT, stdio: 'pipe' });

console.log('[2/4] 创建输出目录复制编译产物...');
copyRecursive(join(ROOT, 'dist'), join(OUT_DIR, 'dist'));
copyFileSync(join(ROOT, 'start.cjs'), join(OUT_DIR, 'start.cjs'));
if (existsSync(join(ROOT, 'src/webui/index.html'))) {
  copyFileSync(join(ROOT, 'src/webui/index.html'), join(OUT_DIR, 'index.html'));
}

console.log('[3/4] 创建 package.json...');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
writeFileSync(join(OUT_DIR, 'package.json'), JSON.stringify({
  name: 'hermes-lite', version: pkg.version + '-lite', type: 'module', private: true,
  dependencies: { busboy: pkg.dependencies.busboy, mammoth: pkg.dependencies.mammoth,
    'pdf-parse': pkg.dependencies['pdf-parse'], 'sql.js': pkg.dependencies['sql.js'],
    'tesseract.js': pkg.dependencies['tesseract.js'], xlsx: pkg.dependencies.xlsx },
}, null, 2));

console.log('[4/4] 创建启动配置...');
writeFileSync(join(OUT_DIR, '.env.example'), 'DEEPSEEK_API_KEY=your_key_here\nPORT=3000\n');
writeFileSync(join(OUT_DIR, 'start.bat'), '@echo off\nnpm install --production\nnode start.cjs\npause\n');

console.log(`\n✅ 轻量版打包完成: ${OUT_DIR}`);
console.log('   cd dist/hermes-lite && npm install && node start.cjs\n');
