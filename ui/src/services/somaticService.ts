/**
 * SomaticService — 躯体感知记忆 API 客户端
 *
 * 读取躯体记忆状态（当前强度、活跃模式），用于 3D 粒子情感响应。
 */
const API_BASE = '/api';

export interface SomaticStats {
  totalSignals: number;
  totalPatterns: number;
  activePattern: string | null;
  intensity: number;
}

/** 获取当前躯体记忆状态 */
export async function fetchSomaticState(): Promise<SomaticStats> {
  try {
    const res = await fetch(`${API_BASE}/somatic`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { totalSignals: 0, totalPatterns: 0, activePattern: null, intensity: 0 };
    return res.json();
  } catch {
    return { totalSignals: 0, totalPatterns: 0, activePattern: null, intensity: 0 };
  }
}
