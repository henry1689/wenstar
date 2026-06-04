/**
 * thoughtService — M1-M8 真实思维数据管道
 *
 * 职责：
 * 1. 将原始 API 数据格式化为易读的 ThoughtEntry
 * 2. 定时轮询后端获取 M6-M8 数据
 * 3. 外部调用 pushChatModules() 注入 M1-M5 数据
 */
import { useThoughtStore, type ThoughtEntry, MODULE_META } from '../store/thoughtStore';

const API_BASE = '/api';

// ──────────────────────────────────────────────
// M1-M5 格式化（来自聊天响应）
// ──────────────────────────────────────────────

/**
 * 从聊天响应提取 M1-M5 并推入思维流
 */
export function pushChatModules(data: {
  m1: any; m3: any; m4: any; m5: any;
}): void {
  const store = useThoughtStore.getState();
  store.setModuleData('m1', data.m1);
  store.setModuleData('m3', data.m3);
  store.setModuleData('m4', data.m4);
  store.setModuleData('m5', data.m5);

  const entries: Omit<ThoughtEntry, 'id' | 'timestamp'>[] = [];

  // M1: DNA 编码
  if (data.m1?.branch_id) {
    const m1 = data.m1;
    const entities = (m1.entities ?? []).map((e: any) => e.name).join(', ');
    entries.push({
      module: 'M1', ...MODULE_META.M1,
      label: `分支 ${m1.branch_id.slice(0, 8)}…`,
      text: `路径 ${m1.locus_path} · 区域 ${m1.leaf_zone}${entities ? ` · 实体 ${entities}` : ''}`,
      energy: 0.9,
    });
  }

  // M3: 情感感知
  if (data.m3?.quadrant1) {
    const m3 = data.m3;
    // 取每个象限 top-2 维度
    const topDims = [
      ...(m3.quadrant1 ?? []).slice(0, 2),
      ...(m3.quadrant3 ?? []).slice(0, 1),
      ...(m3.quadrant4 ?? []).slice(0, 1),
    ];
    const dimStr = topDims.map((d: any) => `${d.label}=${d.value.toFixed(2)}`).join(' · ');
    const ca = m3.calcium;
    entries.push({
      module: 'M3', ...MODULE_META.M3,
      label: `钙化 ${ca.label} (${ca.score.toFixed(2)})`,
      text: `${dimStr} · 动作: ${(m3.actions ?? []).join(', ')}`,
      energy: Math.min(ca.score, 1),
    });
  }

  // M4: 记忆检索
  if (data.m4?.timeline) {
    const m4 = data.m4;
    const recent = m4.timeline.slice(-2).map((t: any) => t.summary).join(' → ');
    entries.push({
      module: 'M4', ...MODULE_META.M4,
      label: `检索 ${m4.total} 条记录`,
      text: recent || `家族关联 ${m4.family} 个`,
      energy: Math.min((m4.total ?? 0) / 20, 1),
    });
  }

  // M5: 表达策略
  if (data.m5?.strategy_id) {
    const m5 = data.m5;
    entries.push({
      module: 'M5', ...MODULE_META.M5,
      label: m5.description || m5.strategy_id,
      text: `语调 ${m5.tone} · 深度 ${m5.depth} · 最大长度 ${m5.max_length}`,
      energy: m5.depth === 'deep' ? 0.9 : m5.depth === 'medium' ? 0.6 : 0.3,
    });
  }

  for (const e of entries) store.pushThought(e);
}

// ──────────────────────────────────────────────
// M6-M8 轮询
// ──────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function fmtTraits(traits: Record<string, number>): string {
  return Object.entries(traits ?? {})
    .map(([k, v]) => `${k}=${(v as number).toFixed(1)}`)
    .join(' · ');
}

/**
 * 拉取 /api/modules 数据并推入思维流
 */
async function pollModules(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/modules`);
    if (!res.ok) return;
    const data = await res.json();
    const store = useThoughtStore.getState();

    // M6: 自我模型
    if (data.m6?.traits) {
      store.setModuleData('m6', data.m6);
      store.pushThought({
        module: 'M6', ...MODULE_META.M6,
        label: '特质快照',
        text: fmtTraits(data.m6.traits) + (data.m6.narrative_layers?.length
          ? ` · 叙事层 ${data.m6.narrative_layers.length} 层` : ''),
        energy: 0.5,
      });
    }

    // M7: 梦境队列
    if (data.m7) {
      store.setModuleData('m7', data.m7);
      if (data.m7.total_pending > 0 || data.m7.pending_dreams?.length > 0) {
        store.pushThought({
          module: 'M7', ...MODULE_META.M7,
          label: `待处理 ${data.m7.total_pending ?? data.m7.pending_dreams.length} 个`,
          text: `交互日志 ${data.m7.total_logs ?? 0} 条`,
          energy: Math.min((data.m7.total_pending ?? 0) / 5, 1),
        });
      }
    }

    // M8: 年轮记录
    if (data.m8) {
      store.setModuleData('m8', data.m8);
      const scarsInfo = data.m8.unhealed_scars > 0
        ? ` · 未愈合疤痕 ${data.m8.unhealed_scars}`
        : '';
      store.pushThought({
        module: 'M8', ...MODULE_META.M8,
        label: `总 ${data.m8.total_entries} 条记录`,
        text: `疤痕 ${data.m8.total_scars} (愈合 ${data.m8.healed_scars})${scarsInfo}`,
        energy: data.m8.unhealed_scars > 0 ? 0.7 : 0.3,
      });
    }
  } catch {
    // 后端未启动 — 静默忽略
  }
}

// ──────────────────────────────────────────────
// 归纳感悟 + 关系图 轮询
// ──────────────────────────────────────────────

let inductionTimer: ReturnType<typeof setInterval> | null = null;

async function pollInductions(): Promise<void> {
  try {
    const store = useThoughtStore.getState();

    // 获取归纳感悟
    const indRes = await fetch(`${API_BASE}/inductions`);
    if (indRes.ok) {
      const indData = await indRes.json();
      const reflections = (indData.inductions ?? [])
        .filter((i: any) => i.reflection)
        .slice(-1); // 只看最新一条

      for (const ind of reflections) {
        store.pushThought({
          module: 'IN',
          ...MODULE_META.IN,
          label: `💭 ${new Date(ind.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`,
          text: ind.reflection.substring(0, 120) + (ind.reflection.length > 120 ? '...' : ''),
          energy: Math.min(ind.avg_calcium, 1),
        });
      }
    }

    // 获取关系图摘要
    const relRes = await fetch(`${API_BASE}/relations`);
    if (relRes.ok) {
      const relData = await relRes.json();
      if (relData.count >= 5) {
        store.pushThought({
          module: 'RE',
          ...MODULE_META.RE,
          label: `${relData.count} 条关联`,
          text: relData.relations.slice(-5).map((r: any) => `${r.entityA}→${r.entityB}`).join(' · '),
          energy: Math.min(relData.count / 15, 1),
        });
      }
    }
  } catch {
    // 静默
  }
}

/**
 * 启动 M6-M8 + 归纳轮询
 */
export function startPolling(): void {
  stopPolling();
  pollModules();
  pollTimer = setInterval(pollModules, 15_000);

  pollInductions();
  inductionTimer = setInterval(pollInductions, 60_000);
}

export function stopPolling(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (inductionTimer) { clearInterval(inductionTimer); inductionTimer = null; }
}
