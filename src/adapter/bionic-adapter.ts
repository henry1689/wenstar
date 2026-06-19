/**
 * 仿生智脑适配器 — Bionic Adapter
 *
 * 连接玉瑶·太虚境 (WenStar) ↔ 仿生智脑 (Bionic Cognitive Engine)
 * + 情感谱曲引擎 (Emotion Composer)
 *
 * 设计原则：
 *   1. 可选依赖 — 后端不可用时降级运行，不阻塞聊天
 *   2. 异步非阻塞 — 存储和谱曲异步执行
 *   3. 歌单完整 — 歌词+曲谱(VAD)一体存储
 *
 * 环境变量:
 *   BIONIC_API_URL=http://localhost:7200/api/v1
 *   EMOTION_API_URL=http://localhost:8100/api/v1/emotion
 *
 * 用法:
 *   import { bionic } from './adapter/bionic-adapter.js';
 *   await bionic.search('你好', null, 'user_123');
 */
import type { Perception24D } from '../m3/types/perception.js';
import { LocalCache } from '../app/tools/LocalCache.js';
import { createHash } from 'node:crypto';

// ── 配置 ──
const BIONIC_API = process.env.BIONIC_API_URL || 'http://localhost:7200/api/v1';
const EMOTION_API = process.env.EMOTION_API_URL || 'http://localhost:8100/api/v1/emotion';

// 外部查询缓存：按 query+userId 缓存 30 秒（短期防重复，不阻塞新鲜结果）
const bionicSearchCache = new LocalCache<string, any[]>({ ttlMs: 30_000, namespace: 'bionic_search' });

/** P1: 情感指纹缓存 — 离线降级用 */
const _bionicLocalCache = new LocalCache<string, any>({ ttlMs: 60_000, namespace: 'bionic_fallback', maxKeys: 200 });
function _genCtxHash(input: string, emotion?: { pleasure?: number; arousal?: number }): string {
  const payload = input + '_' + (emotion?.pleasure?.toFixed(2) || '0') + '_' + (emotion?.arousal?.toFixed(2) || '0');
  try { return createHash('sha256').update(payload).digest('hex').substring(0, 16); } catch { return payload.substring(0, 32); }
}

// ── 类型定义 ──

export interface BionicSearchResult {
  id: string;
  event_id?: string;
  topic?: string;
  core_facts?: string;
  source: string;
  created_at?: string;
}

/** 语境相关性判定 — 整句语义优先 */
export interface ContextRelevance {
  is_directed: boolean;    // 情感是否指向对话对方
  is_narrative: boolean;   // 是否是客观叙事/描述
  explanation: string;     // 判定说明
}

/** VAD 谱曲结果（情感谱曲引擎输出） */
export interface VadSpectrum {
  overall: {
    valence: number;
    arousal: number;
    dominant_emotion: string;
    emotional_arc: string;
    dynamic_tension: { intensity: number; amplitude: number; frequency: number };
  };
  peaks: Array<{ sequence: number; text: string; peak_type: string; intensity: number }>;
  score: number;
  confidence: number;
  context_relevance?: ContextRelevance;
}

/** 歌单：歌词+曲谱 一体 */
export interface SongSheet {
  topic: string;
  turns: Array<{ role: string; content: string }>;
  emotion24d?: Perception24D;
  vad?: VadSpectrum | null;
  userId?: string;
}

// ── HTTP 工具 ──

/** 简化的 HTTP 请求（针对 Node.js fetch 做了兼容处理） */
async function bionicFetch<T>(path: string, options?: { method?: string; body?: string }, timeout = 5000): Promise<T | null> {
  const url = `${BIONIC_API}${path}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const resp = await fetch(url, {
      method: options?.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options?.body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[BionicAdapter] ${resp.status} ${url}: ${text.slice(0, 100)}`);
      return null;
    }
    return await resp.json() as T;
  } catch (err) {
    console.warn(`[BionicAdapter] 失败 ${url}:`, (err as Error).message);
    return null;
  }
}

// ── 适配器核心 ──

class BionicAdapter {
  /** 仿生智脑是否在线 */
  async health(): Promise<boolean> {
    const r = await bionicFetch<any>('/health');
    return r?.status === 'ok';
  }

  /** 检索相关记忆（同步，对话回复前调用，带 30 秒缓存） */
  async search(query: string, userId = 'default_user'): Promise<BionicSearchResult[]> {
    const cacheKey = `${userId}:${query.slice(0, 100)}`;
    const cached = await bionicSearchCache.get(cacheKey);
    if (cached) return cached as BionicSearchResult[];

    const _ctxHash = _genCtxHash(query);
    const r = await bionicFetch<any>(
      `/search?q=${encodeURIComponent(query.slice(0, 200))}&user_id=${encodeURIComponent(userId)}&limit=5`
    ).catch(async function(err) {
      console.warn('[Bionic] 搜索失败, 尝试本地缓存:', err.message);
      const _cached = await _bionicLocalCache.get(_ctxHash).catch(function() { return null; });
      if (_cached && Array.isArray(_cached)) {
        console.log('[Bionic] 离线降级(缓存命中): ' + query.slice(0, 40));
        return { results: _cached };
      }
      throw err;
    });
    const results = r?.results ?? [];
    if (results.length > 0) {
      bionicSearchCache.set(cacheKey, results).catch(function() {});
      _bionicLocalCache.set(_ctxHash, results).catch(function() {});
    }
    return results;
  }

  /** 存入歌单（异步，对话结束后调用） */
  async storeSongSheet(sheet: SongSheet): Promise<boolean> {
    if (!sheet.turns.length) return true;
    const emotionVec = sheet.emotion24d
      ? [
          sheet.emotion24d.pleasure, sheet.emotion24d.arousal,
          sheet.emotion24d.dominance, sheet.emotion24d.aggression,
          sheet.emotion24d.sincerity, sheet.emotion24d.humor,
          sheet.emotion24d.factual, sheet.emotion24d.logical,
          sheet.emotion24d.certainty, sheet.emotion24d.abstract,
          sheet.emotion24d.temporal_focus, sheet.emotion24d.self_ref,
          sheet.emotion24d.intimacy, sheet.emotion24d.power_diff,
          sheet.emotion24d.dependency, sheet.emotion24d.moral_judgment,
          sheet.emotion24d.etiquette, sheet.emotion24d.belonging,
          sheet.emotion24d.sexual_attraction, sheet.emotion24d.sensory_craving,
          sheet.emotion24d.energy_merge, sheet.emotion24d.possessiveness,
          sheet.emotion24d.ecstasy, sheet.emotion24d.safety,
        ]
      : undefined;

    const body: any = {
      topic: sheet.topic,
      raw_dialogue: sheet.turns,
      user_id: sheet.userId || 'default_user',
    };
    if (emotionVec) body.emotion_vector = emotionVec;
    if (sheet.vad) body.vad_spectrum = sheet.vad;

    const r = await bionicFetch<any>('/ingest-test', { method: 'POST', body: JSON.stringify(body) }, 10000);
    if (r?.status === 'injected' && sheet.vad) console.log(`[BionicStore] VAD谱曲已存入`);
    else if (r?.status === 'injected') console.log(`[BionicStore] 纯歌词已存入（待谱曲）`);
    return r?.status === 'injected';
  }

  /** 调用情感谱曲引擎（异步，不阻塞回复） */
  async composeEmotion(text: string): Promise<VadSpectrum | null> {
    try {
      const resp = await fetch(`${EMOTION_API}/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 10000) }),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;
      const r = await resp.json() as any;
      return {
        overall: {
          valence: r.overall.valence,
          arousal: r.overall.arousal,
          dominant_emotion: r.overall.dominant_emotion,
          emotional_arc: r.overall.emotional_arc,
          dynamic_tension: r.overall.dynamic_tension,
        },
        peaks: (r.peaks || []).map((p: any) => ({ sequence: p.sequence, text: p.text, peak_type: p.peak_type, intensity: p.intensity })),
        score: r.confidence,
        confidence: r.confidence,
        context_relevance: r.context_relevance || { is_directed: true, is_narrative: false, explanation: '8100未返回语境判定，默认放行' },
      };
    } catch { return null; }
  }

  /** 获取金库列表 */
  async getGoldList(userId = 'default_user', page = 1): Promise<any[]> {
    const r = await bionicFetch<any>(`/docs/gold?user_id=${encodeURIComponent(userId)}&page=${page}`);
    return r?.items ?? [];
  }

  /** 获取黑钻列表 */
  async getDiamondList(userId = 'default_user', page = 1): Promise<any[]> {
    const r = await bionicFetch<any>(`/docs/diamonds?user_id=${encodeURIComponent(userId)}&page=${page}`);
    return r?.items ?? [];
  }

  /** 存入金库（仿生智脑永久存储） */
  async storeGold(params: { title: string; content: string; tags?: string[]; userId?: string }): Promise<boolean> {
    const body: any = {
      topic: params.title.substring(0, 100),
      raw_dialogue: params.content.substring(0, 50000),
      user_id: params.userId || 'default_user',
    };
    if (params.tags) body.tags = params.tags;
    const r = await bionicFetch<any>('/docs/upload', { method: 'POST', body: JSON.stringify(body) }, 15000);
    if (r?.id) {
      console.log('[BionicGold] ✅ 已存入金库:', params.title.substring(0, 40));
      return true;
    }
    return false;
  }
}

export const bionic = new BionicAdapter();
