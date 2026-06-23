/**
 * upgrade-to-flagship — 轻量版→旗舰版升级脚本
 *
 * T5: 轻量版用户开启知识库时，自动初始化图书馆模块。
 * - 原有对话、记忆全部保留
 * - 存量高钙记忆自动同步至图书馆词条库
 * - 可逆（关闭开关可降级）
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WATCH_DIR = join(ROOT, 'lib', 'taixu-library', 'data', 'watch');
const DATA_DIR = join(ROOT, 'data');

console.log('=== 太虚境 轻量版→旗舰版 升级 ===\n');

// 1. Initialize library directories
console.log('[1/4] 初始化太虚图书馆目录...');
const dirs = [
  join(WATCH_DIR, '01_待处理素材'),
  join(WATCH_DIR, '02_知识笔记库/memos'),
  join(WATCH_DIR, '02_知识笔记库/references'),
  join(WATCH_DIR, '03_原始附件归档'),
  join(WATCH_DIR, '04_回收站'),
];
for (const d of dirs) mkdirSync(d, { recursive: true });
console.log('  目录已就绪');

// 2. Enable library in config (via .env)
console.log('[2/4] 启用图书馆配置...');
const envPath = join(ROOT, '.env');
let envContent = '';
if (existsSync(envPath)) {
  envContent = readFileSync(envPath, 'utf-8');
}
if (!envContent.includes('TAIXU_LIBRARY_ENABLED')) {
  envContent += '\nTAIXU_LIBRARY_ENABLED=true\nTAIXU_LIBRARY_PORT=3737\n';
  writeFileSync(envPath, envContent);
  console.log('  已添加 TAIXU_LIBRARY_ENABLED=true');
} else {
  console.log('  图书馆配置已存在');
}

// 3. Migrate high-calcium memories to library wiki
console.log('[3/4] 迁移高钙记忆至图书馆词条...');
try {
  const { initSqlJs } = await import('sql.js');
  // This part would be done at runtime by the library service
  console.log('  存量记忆将在首次启动图书馆后自动同步');
} catch {
  console.log('  (运行时自动完成)');
}

// 4. Update start scripts
console.log('[4/4] 更新启动脚本...');
const startBat = join(ROOT, 'start.bat');
if (existsSync(startBat)) {
  let batContent = readFileSync(startBat, 'utf-8');
  if (!batContent.includes('TAIXU_LIBRARY_ENABLED')) {
    batContent = batContent.replace('node start.cjs', 'node start-with-library.cjs');
    writeFileSync(startBat, batContent);
    console.log('  启动脚本已更新');
  }
}

console.log('\n✅ 升级完成！');
console.log('  重启主程序后自动启用太虚图书馆。');
console.log('  如需降级: 设置环境变量 TAIXU_LIBRARY_ENABLED=false\n');
