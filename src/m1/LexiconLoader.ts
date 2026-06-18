/**
 * LexiconLoader — 统一词表加载器
 *
 * 从 data/lexicons/*.json 加载词表，供 M1 L0Router 和 M3 PerceptionAnalyzer 共享。
 * 词表改为 JSON 配置后，新增词条无需改源码，只需编辑 JSON 文件。
 *
 * 设计原则:
 * - 零依赖：只使用 node:fs 和 node:path
 * - 惰性加载：词表只在首次读取时加载，后续复用
 * - 兜底回退：JSON 文件缺失时返回空数组（不崩溃）
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const LEXICON_DIR = join(PROJECT_ROOT, 'data', 'lexicons');

/** 缓存 */
const cache = new Map<string, any>();
let l0RulesCache: any = null;
let entityRulesCache: any = null;

/**
 * 加载 JSON 词表文件，返回 Set<string>
 * 文件缺失或损坏时返回空 Set
 */
export function loadSet(filename: string, key: string): Set<string> {
  try {
    const path = join(LEXICON_DIR, filename);
    if (!existsSync(path)) {
      console.warn(`[LexiconLoader] ${filename} not found, using empty set.`);
      return new Set();
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const arr = data[key] ?? [];
    return new Set<string>(arr);
  } catch (err) {
    console.warn(`[LexiconLoader] Failed to load ${filename}[${key}]: ${err}`);
    return new Set();
  }
}

/**
 * 加载情感词表（从 emotion_lexicon.json）
 */
export function loadEmotionLexicon(): Record<string, Set<string>> {
  const key = 'emotion_lexicon';
  if (cache.has(key)) return cache.get(key);

  const lex: Record<string, Set<string>> = {
    positive_words: loadSet('emotion_lexicon.json', 'positive_words'),
    negative_words: loadSet('emotion_lexicon.json', 'negative_words'),
    high_arousal: loadSet('emotion_lexicon.json', 'high_arousal'),
    low_arousal: loadSet('emotion_lexicon.json', 'low_arousal'),
    dominant: loadSet('emotion_lexicon.json', 'dominant'),
    submissive: loadSet('emotion_lexicon.json', 'submissive'),
    aggression: loadSet('emotion_lexicon.json', 'aggression'),
    sincerity: loadSet('emotion_lexicon.json', 'sincerity'),
    humor: loadSet('emotion_lexicon.json', 'humor'),
    certain: loadSet('emotion_lexicon.json', 'certain'),
    hedge: loadSet('emotion_lexicon.json', 'hedge'),
    logical: loadSet('emotion_lexicon.json', 'logical'),
    abstract: loadSet('emotion_lexicon.json', 'abstract'),
    temporal_past: loadSet('emotion_lexicon.json', 'temporal_past'),
    temporal_future: loadSet('emotion_lexicon.json', 'temporal_future'),
    intimacy: loadSet('emotion_lexicon.json', 'intimacy'),
    dependency: loadSet('emotion_lexicon.json', 'dependency'),
    moral_positive: loadSet('emotion_lexicon.json', 'moral_positive'),
    moral_negative: loadSet('emotion_lexicon.json', 'moral_negative'),
    etiquette: loadSet('emotion_lexicon.json', 'etiquette'),
    sexual_attraction: loadSet('emotion_lexicon.json', 'sexual_attraction'),
    sensory_craving: loadSet('emotion_lexicon.json', 'sensory_craving'),
    energy_merge: loadSet('emotion_lexicon.json', 'energy_merge'),
    ecstasy: loadSet('emotion_lexicon.json', 'ecstasy'),
  };

  cache.set(key, lex);
  return lex;
}

/**
 * P2: 加载 L3 实体提取规则（从 entity_rules.json）
 */
export function loadEntityRules(): Array<{ name: string; type: string; patterns: string[] }> {
  if (entityRulesCache !== null) return entityRulesCache;
  try {
    const path = join(__dirname, 'config', 'entity_rules.json');
    if (!existsSync(path)) {
      console.warn('[LexiconLoader] entity_rules.json not found, using fallback.');
      entityRulesCache = [];
      return entityRulesCache;
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    entityRulesCache = data.rules ?? [];
    return entityRulesCache;
  } catch (err) {
    console.warn(`[LexiconLoader] Failed to load entity_rules.json: ${err}`);
    entityRulesCache = [];
    return entityRulesCache;
  }
}

/**
 * 加载 L0 路由规则（从 l0_routing.json）
 */
export function loadL0Rules(): Array<{ id: string; keywords: string[]; domain: string; subcategory: string; priority: number }> {
  if (l0RulesCache !== null) return l0RulesCache;

  try {
    const path = join(LEXICON_DIR, 'l0_routing.json');
    if (!existsSync(path)) {
      console.warn('[LexiconLoader] l0_routing.json not found, using empty rules.');
      l0RulesCache = [];
      return l0RulesCache;
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    l0RulesCache = data.rules ?? [];
    return l0RulesCache;
  } catch (err) {
    console.warn(`[LexiconLoader] Failed to load l0_routing.json: ${err}`);
    l0RulesCache = [];
    return l0RulesCache;
  }
}
