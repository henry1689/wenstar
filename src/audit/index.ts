#!/usr/bin/env tsx
/**
 * 玉瑶 · 太虚境 全功能审计入口
 *
 * 用法:
 *   npx tsx src/audit/index.ts            # 跑全部46项
 *   npx tsx src/audit/index.ts --quick    # 跑快速体检8项
 *   npx tsx src/audit/index.ts --memory   # 只跑记忆模块
 */
import type { CheckResult } from './types.js';
import { generateReport, saveReport, printReport } from './report.js';

async function main() {
  const args = process.argv.slice(2);
  const isQuick = args.includes('--quick');
  const module = args.find(a => a.startsWith('--'))?.replace('--', '') || 'all';

  let results: CheckResult[] = [];

  if (isQuick) {
    const { runQuickHealth } = await import('./quick-health.js');
    results = await runQuickHealth();
  } else if (module === 'memory') {
    const { checkMemoryAll } = await import('./checks/memory.js');
    results = await checkMemoryAll();
  } else if (module === 'knowledge') {
    const { checkKnowledgeAll } = await import('./checks/knowledge.js');
    results = await checkKnowledgeAll();
  } else if (module === 'profile') {
    const { checkProfileAll } = await import('./checks/profile.js');
    results = await checkProfileAll();
  } else if (module === 'ops') {
    const { checkOpsAll } = await import('./checks/ops.js');
    results = await checkOpsAll();
  } else {
    // 跑全部
    const { checkMemoryAll } = await import('./checks/memory.js');
    const { checkKnowledgeAll } = await import('./checks/knowledge.js');
    const { checkProfileAll } = await import('./checks/profile.js');
    const { checkOpsAll } = await import('./checks/ops.js');
    const { checkFrontendAll } = await import('./checks/frontend.js');

    const all = await Promise.all([
      checkMemoryAll(),
      checkKnowledgeAll(),
      checkProfileAll(),
      checkOpsAll(),
      checkFrontendAll(),
    ]);
    results = all.flat();
  }

  const report = generateReport(results);
  const filePath = saveReport(report);
  printReport(report);
  console.log(`📄 报告已保存: ${filePath}`);
}

main().catch(err => {
  console.error('审计执行失败:', err);
  process.exit(1);
});
