#!/usr/bin/env node
/**
 * 太虚境·48小时系统观测脚本
 *
 * 每小时自动采集系统运行状态，输出到 data/observation/。
 * 使用方法：
 *   后台运行: nohup node scripts/observation-report.cjs &
 *   单次执行: node scripts/observation-report.cjs --once
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const OBS_DIR = path.join(PROJECT_ROOT, 'data', 'observation');
const HOST = 'http://localhost:3000';

// ─── 工具函数 ───

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', (err) => resolve(null));
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = http.request(options, (res) => {
      let resp = '';
      res.on('data', (chunk) => resp += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(resp)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

// ─── 采集项 ───

async function collect() {
  const now = timestamp();
  const snapshot = { timestamp: now };

  // 1. 幻觉日志数
  const hallu = await httpGet(`${HOST}/api/hallucination/log`);
  snapshot.hallucinationCount = (hallu && hallu.count) || 0;

  // 2. MemoryAssessor 晋升
  const assessor = await httpPost(`${HOST}/api/assessor/run?action=sand`);
  snapshot.assessorStatus = (assessor && assessor.status) || 'error';

  // 3. 对话健康
  const health = await httpGet(`${HOST}/api/health`);
  snapshot.healthStatus = health ? 'ok' : 'down';

  // 4. 服务器进程
  snapshot.serverUp = snapshot.healthStatus === 'ok';

  // 5. 系统时间
  snapshot.systemTime = timestamp();

  return snapshot;
}

// ─── 报告输出 ───

function writeSnapshot(snapshot) {
  ensureDir(OBS_DIR);
  const date = new Date().toISOString().substring(0, 13).replace('T', '-');
  const filePath = path.join(OBS_DIR, `snapshot-${date}.json`);
  const existing = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    : { snapshots: [] };
  existing.snapshots.push(snapshot);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function writeQuickCheck(runtime) {
  const filePath = path.join(OBS_DIR, 'quick-checks.json');
  const entry = { timestamp: timestamp(), runtimeHours: runtime };
  const existing = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    : { checks: [] };
  existing.checks.push(entry);

  const lastSnapshots = collectRecentSnapshots(12);
  if (lastSnapshots.length > 0) {
    entry.hallucinationTotal = lastSnapshots.reduce((s, x) => s + (x.hallucinationCount || 0), 0);
    entry.avgHallucinationPerHour = (entry.hallucinationTotal / lastSnapshots.length).toFixed(2);
    entry.serverUpCount = lastSnapshots.filter(x => x.serverUp).length;
    entry.serverUpRatio = (entry.serverUpCount / lastSnapshots.length).toFixed(2);
  }

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  console.log(`[观测] ${timestamp().substring(0, 19)} — 已运行 ${runtime}h, 幻觉累计 ${entry.hallucinationTotal || 0}`);
}

function collectRecentSnapshots(hours) {
  const files = fs.readdirSync(OBS_DIR).filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));
  const recentFiles = files.slice(-hours);
  const snapshots = [];
  for (const f of recentFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(OBS_DIR, f), 'utf-8'));
      snapshots.push(...(data.snapshots || []));
    } catch {}
  }
  return snapshots;
}

function writeFinalReport(startTime) {
  const endTime = Date.now();
  const runtimeHours = ((endTime - startTime) / 3600000).toFixed(1);

  const allSnapshots = collectRecentSnapshots(48);
  const quickChecksPath = path.join(OBS_DIR, 'quick-checks.json');
  const quickChecks = fs.existsSync(quickChecksPath)
    ? JSON.parse(fs.readFileSync(quickChecksPath, 'utf-8')).checks || []
    : [];

  const report = {
    reportGenerated: timestamp(),
    runtimeHours: parseFloat(runtimeHours),
    totalSnapshots: allSnapshots.length,
    totalHallucinations: allSnapshots.reduce((s, x) => s + (x.hallucinationCount || 0), 0),
    avgHallucinationPerHour: allSnapshots.length > 0
      ? (allSnapshots.reduce((s, x) => s + (x.hallucinationCount || 0), 0) / allSnapshots.length).toFixed(2)
      : 0,
    serverUptimeRatio: allSnapshots.length > 0
      ? (allSnapshots.filter(x => x.serverUp).length / allSnapshots.length).toFixed(2)
      : 0,
    quickCheckCount: quickChecks.length,
    observations: {
      // 4类隐患观测数据
      lowValueMemoryIntrusion: '待分析：需检查 limited 检索中低分碎片占比',
      oldBlackDiamondDominance: '待分析：需检查老旧黑钻 vs 近期高情绪金库命中率',
      functionalMemoryDecay: '待分析：需检查工作/约定类记忆衰减速度',
      weakRelationInterference: '待分析：需检查多跳检索中弱关联干扰频次',
    },
    rawDataPath: OBS_DIR,
  };

  fs.writeFileSync(path.join(OBS_DIR, 'final-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report;
}

// ─── 主循环 ───

async function main() {
  const isOnce = process.argv.includes('--once');
  const startTime = Date.now();
  const DURATION_MS = 48 * 3600 * 1000;

  ensureDir(OBS_DIR);
  console.log(`[观测] 开始 ${isOnce ? '单次' : '48小时'} 运行模式`);
  console.log(`[观测] 输出目录: ${OBS_DIR}`);

  // 首次采集
  const first = await collect();
  writeSnapshot(first);
  console.log(`[观测] 初始采集: 幻觉=${first.hallucinationCount}`);

  if (isOnce) {
    writeFinalReport(startTime);
    return;
  }

  let hourCounter = 1;
  const interval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    const runtimeHours = (elapsed / 3600000).toFixed(1);

    const snapshot = await collect();
    writeSnapshot(snapshot);

    // 每12小时快检
    if (hourCounter % 12 === 0) {
      writeQuickCheck(runtimeHours);
    }

    console.log(`[观测] +${runtimeHours}h 幻觉=${snapshot.hallucinationCount} 健康=${snapshot.healthStatus}`);

    hourCounter++;

    // 48小时截止
    if (elapsed >= DURATION_MS) {
      clearInterval(interval);
      console.log('[观测] 48小时运行结束，生成最终报告...');
      writeFinalReport(startTime);
      console.log('[观测] 最终报告已生成: ' + path.join(OBS_DIR, 'final-report.json'));
    }
  }, 3600000); // 每小时
}

main().catch(err => console.error('[观测] 错误:', err));
