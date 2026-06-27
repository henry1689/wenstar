/** 审计报告生成 */
import fs from 'node:fs';
import path from 'node:path';
import type { AuditReport, CheckResult } from './types.js';

const COMMIT_ID = '36d5c8b';
const BRANCH = 'fix/taixujing-link-v1';

export function generateReport(results: CheckResult[]): AuditReport {
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const err = results.filter(r => r.status === 'error').length;
  const manual = results.filter(r => r.status === 'manual').length;

  const recommendations: string[] = [];
  for (const r of results) {
    if (r.status === 'failed') {
      recommendations.push(`【${r.id}】${r.name}: ${r.detail}`);
    }
    if (r.status === 'error') {
      recommendations.push(`【${r.id}】${r.name} 执行异常: ${r.error}`);
    }
  }

  const report: AuditReport = {
    auditId: `audit_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    commitId: COMMIT_ID,
    branch: BRANCH,
    summary: { total: results.length, passed, failed, error: err, manual },
    results,
    recommendations,
  };

  return report;
}

export function saveReport(report: AuditReport): string {
  const dir = path.resolve(process.cwd(), 'data/reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `audit-${report.auditId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}

export function printReport(report: AuditReport): void {
  const s = report.summary;
  console.log('\n═══════════════════════════════════════');
  console.log('  玉瑶 · 太虚境 全功能审计报告');
  console.log('═══════════════════════════════════════');
  console.log(`  Audit ID:     ${report.auditId}`);
  console.log(`  时间:         ${report.timestamp.substring(0, 19)}`);
  console.log(`  提交:         ${report.commitId} (${report.branch})`);
  console.log(`  总项:         ${s.total}`);
  console.log(`  ✅ 通过:       ${s.passed}`);
  console.log(`  ❌ 失败:       ${s.failed}`);
  console.log(`  ⚠️  异常:      ${s.error}`);
  console.log(`  👤 需人工确认:  ${s.manual}`);
  console.log(`  通过率:       ${s.total > 0 ? Math.round((s.passed + s.manual) / s.total * 100) : 0}%`);
  console.log('───────────────────────────────────────');

  if (s.failed > 0 || s.error > 0) {
    console.log('\n🔴 整改建议:');
    for (const r of report.recommendations) {
      console.log(`  ${r}`);
    }
  }

  if (s.manual > 0) {
    console.log('\n👤 需人工确认:');
    for (const r of report.results.filter(r => r.status === 'manual')) {
      console.log(`  ${r.id}: ${r.detail}`);
    }
  }

  console.log('\n═══════════════════════════════════════\n');
}
