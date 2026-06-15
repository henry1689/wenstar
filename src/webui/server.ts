#!/usr/bin/env tsx
/**
 * Hermes WebUI Server — 玉瑶 · 太虚境
 *
 * 支持 M1-M8 完整观测数据 API + 持久化对话记忆。
 * 运行: npm run webui  |  访问: http://localhost:3000
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';
import { DNAEncoder } from '../m1/DNAEncoder.js';
import { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import { M3LogicOrchestrator } from '../m3/M3LogicOrchestrator.js';
import { M4Orchestrator } from '../m4/M4Orchestrator.js';
import { M5Orchestrator } from '../m5/M5Orchestrator.js';
import { DeepSeekLLMProvider } from '../m5/DeepSeekLLMProvider.js';
import { FamilyGraph } from '../m4/FamilyGraph.js';
import { MaintenanceService } from './maintenance.js';
import { InductionScheduler } from '../m7/InductionScheduler.js';
import { ConsolidationQueue } from '../m7/ConsolidationQueue.js';
import { M7Orchestrator, startM7Interval } from '../m7/M7Orchestrator.js';
import busboy from 'busboy';
import { M8FusionAdapter } from '../m8/M8FusionAdapter.js';
import { computeCalcium } from '../m2/math.js';
import { getHitReport } from '../m3/PerceptionAnalyzer.js';
import { rerank } from '../m4/Reranker.js';
import { decompose, mergeDecomposedResults } from '../m4/QueryDecomposer.js';
import { WorkingMemory } from '../m9/WorkingMemory.js';
import { PersonaRegistry } from '../app/persona/PersonaRegistry.js';
import { yuyaoPersona } from '../app/persona/built-in/yuyao/index.js';
import { secretaryPersona } from '../app/persona/built-in/secretary/index.js';
import { mentorPersona } from '../app/persona/built-in/mentor/index.js';
import { counselorPersona } from '../app/persona/built-in/counselor/index.js';
import { celebrityPersona } from '../app/persona/built-in/celebrity/index.js';
import { colleaguePersona } from '../app/persona/built-in/colleague/index.js';
import { customPersona } from '../app/persona/built-in/custom/index.js';
import { extractRelations, storeRelations } from '../app/knowledge/RelationshipExtractor.js';
import { TopicTracker } from '../app/knowledge/TopicTracker.js';
import { researchTopic } from '../app/knowledge/WebResearchService.js';
import { M6Orchestrator } from '../m6/M6Orchestrator.js';
import { KnowledgeBase } from '../m2/KnowledgeBase.js';
import { M5ClueAssistant } from '../m5/clue/M5ClueAssistant.js';
import { ClueTracker } from '../m7/ClueTracker.js';
import { TaskAgentEngine, ToolRegistry, calendarTool, reminderTool, noteTool, createSearchTool, startReminderChecker } from '../app/task-agent/index.js';
import { excelToJson, jsonToExcel, parseFile } from '../app/knowledge/FileUploadService.js';
import { listKeys, setKey, deleteKey, getKeyValue } from '../app/shared/ApiKeyStorage.js';
import { SomaticMemory } from '../app/somatic/SomaticMemory.js';
import { MemoryVault } from '../app/memory-vault/MemoryVault.js';
import type { SimilarityMode, ScoredMemory } from '../m2/types/index.js';
import type { SelfModelV1 } from '../m1/types/dna.js';
import type { ConversationTurn } from '../m5/types/index.js';
import type { M3Decision } from '../m3/types/perception.js';
import { processChat as processChatNew } from './chat.js';
import type { ChatContext } from './chat.js';

// ── 路径 ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data', 'webui');
const DB_PATH = path.join(DATA_DIR, 'knowledge', 'family_graph.db');
const HTML_PATH = path.join(__dirname, 'index.html');
const CONV_LOG_PATH = path.join(DATA_DIR, 'conversations.json');
const PORT = parseInt(process.env.PORT || '3000', 10);

// M6 自我模型（延迟初始化，在 initPipeline 中赋值）
let m6: M6Orchestrator;

/** 从 M6 自我模型动态构建 SelfModelV1 */
function getSelfModel(): SelfModelV1 {
  if (!m6) {
    return {
      identity: { name: '玉瑶', persona: '温柔深情的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
      traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
      boundaries: [], preferences: { likes: [], dislikes: [] },
      narrative_identity: '我是玉瑶',
    };
  }
  const model = m6.manager.getModel();
  return {
    identity: { name: '玉瑶', persona: '温柔深情的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
    traits: { ...model.traits },
    boundaries: model.boundaries.map(b => b.rule),
    preferences: {
      likes: model.preferences.filter(p => p.type === 'like').map(p => p.name),
      dislikes: model.preferences.filter(p => p.type === 'dislike').map(p => p.name),
    },
    narrative_identity: model.narrative_layers.length > 0
      ? model.narrative_layers[model.narrative_layers.length - 1].text
      : '我是玉瑶',
  };
}

// ── 对话记忆 ──
let conversationHistory: ConversationTurn[] = [];
const MAX_SAVED_TURNS = 200; // 保留最近 100 轮完整对话（鸿艺要求）
function loadConversationHistory(): void {
  try {
    if (existsSync(CONV_LOG_PATH)) {
      const raw = fs.readFileSync(CONV_LOG_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        conversationHistory = data.filter(
          (t: any) => t.role && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'
        );
      }
      console.log(`  从磁盘加载了 ${conversationHistory.length} 条对话记忆 ✓`);
    }
  } catch (err) { console.error('[Conv] 加载对话历史失败:', err); conversationHistory = []; }
}
let _convSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveConversationHistory(): void {
  // 防抖：500ms 内的多次写入合并为一次
  if (_convSaveTimer) clearTimeout(_convSaveTimer);
  _convSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(CONV_LOG_PATH, JSON.stringify(conversationHistory.slice(-MAX_SAVED_TURNS), null, 2), 'utf-8'); } catch (err) { console.error('[Conv] 保存对话历史失败:', err); }
    _convSaveTimer = null;
  }, 500);
}
/** 强制立即保存对话历史（关闭前调用） */
function flushConversationHistory(): void {
  if (_convSaveTimer) { clearTimeout(_convSaveTimer); _convSaveTimer = null; }
  try { fs.writeFileSync(CONV_LOG_PATH, JSON.stringify(conversationHistory.slice(-MAX_SAVED_TURNS), null, 2), 'utf-8'); } catch (err) { console.error('[Conv] 强制保存失败:', err); }
}
function recordTurn(role: 'user' | 'assistant', content: string): void {
  try { conversationHistory.push({ role, content }); saveConversationHistory(); } catch (err) { console.error('[Conv] recordTurn失败:', err); }
}
function resetConversationHistory(): void {
  conversationHistory = [];
  try { if (existsSync(CONV_LOG_PATH)) fs.unlinkSync(CONV_LOG_PATH); } catch (err) { console.error('[Conv] 重置对话历史失败:', err); }
}

// ── 维护引擎 ──
const maintenance = new MaintenanceService();
maintenance.injectDeps({
  conversationHistory,
  getConversationHistory: () => conversationHistory,
  setConversationHistory: (h) => { conversationHistory = h; },
  saveConversationHistory,
  // 惰性 getter — storage 在 initPipeline() 中才赋值
  storage: () => storage,
  // 衰减维护（惰性）
  runDecay: () => storage?.runDecayMaintenance() ?? { total: 0, archived: 0 },
  // 知识库过期未分类条目清理（90天—铁律，惰性）
  runKnowledgeGc: () => (knowledgeBase as any)?.deleteExpiredUnclassified?.(90) ?? 0,
});

// ── 管道 ──
let encoder: DNAEncoder;
let storage: FusionStorageAdapter;
let m3: M3LogicOrchestrator;
let familyGraph: FamilyGraph;
let m4: M4Orchestrator;
let m5: M5Orchestrator;
let inductionScheduler: InductionScheduler;
let consolidationQueue: ConsolidationQueue;
let m7: M7Orchestrator;
let m7Timer: ReturnType<typeof setInterval> | null = null;
let m6Timer: ReturnType<typeof setInterval> | null = null;
let workingMemory: WorkingMemory;
let knowledgeBase: KnowledgeBase;
let clueTracker: ClueTracker;
let llmProvider: DeepSeekLLMProvider;
let clueAssistant: M5ClueAssistant;
let topicTracker: TopicTracker;
let m8: M8FusionAdapter;
let somaticMemory: SomaticMemory;
let taskAgent: TaskAgentEngine;
let memoryVault: MemoryVault;
async function initPipeline(): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  encoder = new DNAEncoder(getSelfModel());
  storage = new FusionStorageAdapter(DATA_DIR);
  await storage.initialize();
  memoryVault = new MemoryVault();
  await memoryVault.initialize();
  familyGraph = new FamilyGraph(DB_PATH);
  await familyGraph.initialize();
  m4 = new M4Orchestrator(storage, familyGraph);
  await m4.initialize();
  m3 = new M3LogicOrchestrator();
  llmProvider = new DeepSeekLLMProvider();
  // 注册默认角色
  PersonaRegistry.register(yuyaoPersona);
  PersonaRegistry.register(secretaryPersona);
  PersonaRegistry.register(mentorPersona);
  PersonaRegistry.register(counselorPersona);
  PersonaRegistry.register(celebrityPersona);
  PersonaRegistry.register(colleaguePersona);
  PersonaRegistry.register(customPersona);
  PersonaRegistry.setActive('yuyao');
  const activePersona = PersonaRegistry.getActive();
  if (activePersona) llmProvider.setPersona(activePersona);
  m5 = new M5Orchestrator(llmProvider);
  loadConversationHistory();
  maintenance.start(); // 启动维护引擎
  console.log('  维护引擎已启动 ✓');

  // 先创建 M8+M7（使 DreamQueue 可供 CQ/IS 联动注入）
  m8 = new M8FusionAdapter(storage);
  m7 = new M7Orchestrator(m8);

  inductionScheduler = new InductionScheduler(storage, m7.queue);
  inductionScheduler.start();
  console.log('  归纳调度器已启动 ✓');
  consolidationQueue = new ConsolidationQueue(storage, m7.queue);
  consolidationQueue.start();
  console.log('  巩固队列已启动 ✓');

  m7Timer = startM7Interval(m7);
  console.log('  梦境引擎已启动 ✓');

  m6 = new M6Orchestrator();
  // 延迟注入 M6 到 M7（修复梦境→演化链路）
  if (m7) m7.setM6(m6);
  // M6 周期性维护（15分钟一次）
  if (m6Timer) clearInterval(m6Timer);
  m6Timer = setInterval(() => { try { m6?.maintenance(); } catch (err) { console.error('[M6] 定时维护失败:', err); } }, 15 * 60 * 1000);
  console.log('  自我模型已启动 ✓');

  // 记忆仓每日备份（启动后5分钟首次执行）
  setTimeout(() => { try { memoryVault?.backup(); } catch {} }, 5 * 60 * 1000);
  console.log('  记忆仓已启动 ✓');

  workingMemory = new WorkingMemory(storage, 50);
  workingMemory.startFlushTimer();
  console.log('  工作记忆已启动 ✓');

  knowledgeBase = new KnowledgeBase(storage.getSQLite());
  topicTracker = new TopicTracker(storage.getSQLite());
  somaticMemory = new SomaticMemory(storage.getSQLite());
  // 玉瑶的"做梦研究"定时器（每5分钟检查一次待研究话题）
  setInterval(async () => {
    try {
      const needs = topicTracker.getTopicsNeedingResearch();
      if (needs.length === 0) return;
      const keyword = needs[0]; // 一次只研究一个
      console.log(`[DreamResearch] 玉瑶梦到「${keyword}」，开始查找...`);
      const result = await researchTopic(keyword, storage.getSQLite());
      if (result) {
        topicTracker.markResearched(keyword, result.entryId);
        console.log(`[DreamResearch] ✅ 梦到并记住「${keyword}」`);
      }
    } catch (err) {
      console.warn('[DreamResearch] 研究失败:', err);
    }
  }, 5 * 60 * 1000); // 5分钟
  console.log('  知识库已启动 ✓');

  // 注册任务代理工具
  ToolRegistry.register(calendarTool);
  ToolRegistry.register(reminderTool);
  ToolRegistry.register(noteTool);
  // 注册 SearchTool — 包装 knowledgeBase.search 供秘书工具调用
  ToolRegistry.register(createSearchTool(
    (keyword: string, limit: number) => knowledgeBase.search(keyword, limit)
  ));
  taskAgent = new TaskAgentEngine();
  startReminderChecker();
  console.log('  任务代理已启动 ✓');

  clueTracker = new ClueTracker();
  clueAssistant = new M5ClueAssistant(m8, clueTracker);
  console.log('  线索助理已启动 ✓');

  console.log(`  融合存储已初始化 (${storage.getSQLite().getStatus().totalRecords} 条记忆 ✓`);
}

import { deriveM5Strategy } from './chat.js';

// ════════════════════════════════════════════════════════
// Chat API
// ════════════════════════════════════════════════════════
interface ChatResponse {
  reply: string; turn_count: number;
  m1: { branch_id: string; locus_path: string; seq_pos: number; leaf_zone: string; ref: string; entities: Array<{ name: string; type: string }>; raw_input: string; entity_genes: any[] };
  m3: {
    quadrant1: any[]; quadrant2: any[]; quadrant3: any[]; quadrant4: any[];
    calcium: { score: number; level: number; label: string; breakdown: any };
    actions: string[]; reason: string;
  };
  m4: { timeline: Array<{ time: string; summary: string; calcium_level?: number }>; total: number; family: number };
  m5: { strategy_id: string; tone: string; depth: string; max_length: number; description: string };
  /** 是否触发了情绪传染（用于前端心动闪烁） */
  emotionalFlash: boolean;
  /** 触发的记忆 ID */
  triggeredMemoryId: string | null;
}


async function processChat(message: string): Promise<ChatResponse> {
  return processChatNew(message, {
    encoder, storage, m3, m4, m5, m6, m7,
    workingMemory, knowledgeBase, clueAssistant, llmProvider,
    topicTracker, consolidationQueue,
    conversationHistory, m8, somaticMemory,
    saveConversationHistory,
    getSelfModel,
  });
}

// ════════════════════════════════════════════════════════
// HTTP Server
// ════════════════════════════════════════════════════════
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    // ── 首页 ──
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML_PATH, 'utf-8'));
      return;
    }

    // ── 聊天 ──
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = JSON.parse(await readBody(req));
      if (!body.message || typeof body.message !== 'string') { res.writeHead(400); res.end(JSON.stringify({error:'message required'})); return; }
      const result = await processChat(body.message.trim());
      let audio_url: string | null = null;
      const tts = body.tts !== false; // 默认开启 TTS
      if (tts && result.reply && result.reply.length < 500) {
        try {
          const ttsRes = await fetch('http://localhost:8765/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: result.reply }),
            signal: AbortSignal.timeout(30000),
          });
          if (ttsRes.ok) {
            const ttsData = await ttsRes.json() as any;
            audio_url = ttsData.url || null;
          }
        } catch (err) {
          console.warn('[TTS] 生成失败:', (err as Error).message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...result, audio_url }));
      return;
    }

    // ── 候选回复偏好记录（用户选择了哪个候选，记录到 M6） ──
    if (req.method === 'POST' && url.pathname === '/api/chat/prefer-candidate') {
      try {
        const body = JSON.parse(await readBody(req));
        const tags = body.tags;
        if (m6 && tags && Array.isArray(tags)) {
          for (const tag of tags) {
            m6.prefs.recordMention(tag, 0.8);
          }
          console.log('[Preference] 候选偏好已记录:', tags.join(', '));
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[Preference] 记录失败:', err);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }

    // ── 聊天 SSE 流式输出（先发头再处理，避免 EventSource 超时） ──
    if (req.method === 'GET' && url.pathname === '/api/chat/stream') {
      const rawMessage = url.searchParams.get('message') || '';
      if (!rawMessage) { res.writeHead(400); res.end(JSON.stringify({error:'message required'})); return; }

      // 先发响应头，保持连接不超时
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // 发送 keepalive，让 EventSource 确认连接成功
      res.write(`: keepalive\n\n`);
      res.flushHeaders?.();

      // 再处理聊天（LLM 调用约 1.5~2s）
      const result = await processChat(rawMessage.trim());
      const reply = result.reply || '';

      // 元数据
      res.write(`data: ${JSON.stringify({ type: 'meta', turn_count: result.turn_count, emotionalFlash: result.emotionalFlash, triggeredMemoryId: result.triggeredMemoryId })}\n\n`);

      // 逐块发送文本
      const chunks = reply.split(/(?<=[。！？\n，])|(?<=[，])/g).filter(Boolean);
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
        const delay = chunk.length <= 3 ? 15 : chunk.length <= 10 ? 30 : 50;
        await new Promise(r => setTimeout(r, delay));
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    // ── 重置 ──
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      // 停止所有定时器，防止泄漏
      maintenance.stop();
      inductionScheduler?.stop();
      consolidationQueue?.stop();
      if (m7Timer) { clearInterval(m7Timer); m7Timer = null; }
      if (m6Timer) { clearInterval(m6Timer); m6Timer = null; }
      resetConversationHistory();
      await initPipeline();
      res.writeHead(200); res.end(JSON.stringify({status:'ok',message:'已重置'}));
      return;
    }

    // ── 状态（含M2存储+家族） ──
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const storageStatus = await storage.getStatus().catch(() => null);
      const familySummary = await familyGraph.getFamilySummary().catch(() => ({ members: [], locations: [] }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'running', version: '0.1.0',
        conversation_turns: Math.floor(conversationHistory.length / 2),
        storage: storageStatus ? {
          total_records: storageStatus.totalRecords,
          zone_counts: storageStatus.zoneCounts,
          seq_pos: storageStatus.currentSeqPos,
        } : null,
        family: { members: familySummary.members.map((m: any) => ({ name: m.name, relation: m.relation_to_user })), total: familySummary.members.length },
      }));
      return;
    }

    // ── 健康检查（含维护指标） ──
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const health = maintenance.getHealth();
      const storageStatus = await storage.getStatus().catch(() => null);
      if (storageStatus) {
        health.storage.totalRecords = storageStatus.totalRecords;
      }
      // 添加衰减和地标统计
      const decayStats = storage.getDecayStats();
      const m8st = storage.getSQLite().getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ...health,
        memory: {
          ...health.memory,
          decay: decayStats,
          landmarks: m8st.landmarks,
          entities: m8st.totalEntities,
        },
      }));
      return;
    }

    // ── 手动触发对话压缩 ──
    if (req.method === 'POST' && url.pathname === '/api/maintenance/compact') {
      const result = await maintenance.triggerCompaction();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', ...result }));
      return;
    }

    // ── 对话历史 ──
    if (req.method === 'GET' && url.pathname === '/api/conversation') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ turns: conversationHistory.slice(-100) }));
      return;
    }

    // ── 搜索 ──
    if (req.method === 'POST' && url.pathname === '/api/search') {
      const body = JSON.parse(await readBody(req));
      const query = (body.query || '').trim().toLowerCase();
      if (!query) { res.writeHead(400); res.end(JSON.stringify({error:'query required'})); return; }
      const results = conversationHistory.map((t, i) => ({ index: i, ...t })).filter(t => t.content.toLowerCase().includes(query)).slice(-20);
      res.writeHead(200); res.end(JSON.stringify({ query, total: results.length, results }));
      return;
    }

    // ── 情感相似度搜索（调试/可视化用） ──
    if (req.method === 'POST' && url.pathname === '/api/emotion-search') {
      const body = JSON.parse(await readBody(req));
      const text = (body.query || body.message || '').trim();
      const mode: SimilarityMode = body.mode || 'balanced';
      const limit = body.limit || 10;

      if (!text) { res.writeHead(400); res.end(JSON.stringify({error:'query required'})); return; }

      // 用 M3 分析输入文本，提取感知向量
      const mockDna = {
        branch_id: 'search', seq_pos: 0, locus_path: 'user.misc.default',
        taxonomy_version: '1.0', leaf_zone: 'language_semantic_zone',
        ref: 'tmp', entity_genes: [], raw_input: text, created_at: new Date().toISOString(),
      };
      const decision = m3.decide(mockDna as any);
      const query = {
        current_perception: decision.enhanced.perception,
        locus_path: body.locus_path,
        entities: body.entities || [],
        similarity_mode: mode,
        limit,
      };
      const results = storage.findByEmotionalSimilarity(query);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        query: { text, mode, calcium: computeCalcium(decision.enhanced.perception) },
        results: results.map(r => ({
          id: r.record.id,
          snippet: r.record.raw_input.substring(0, 80),
          created_at: r.record.created_at,
          calcium: r.record.calcium_score,
          strength: Math.round(r.record.effective_strength * 100) / 100,
          scores: {
            composite: Math.round(r.composite * 100) / 100,
            emotional: Math.round(r.scores.emotional * 100) / 100,
            topic: Math.round(r.scores.topic * 100) / 100,
            entity: Math.round(r.scores.entity * 100) / 100,
            calcium_score: Math.round(r.scores.calcium * 100) / 100,
          },
        })),
        total: results.length,
      }));
      return;
    }

    // ── 历史归纳记录 ──
    if (req.method === 'GET' && url.pathname === '/api/inductions') {
      const inductions = inductionScheduler?.getInductions() ?? [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ total: inductions.length, inductions }));
      return;
    }

    // ── 情感地形图 ──
    if (req.method === 'GET' && url.pathname === '/api/landscape') {
      const landscape = storage.getEmotionalLandscape();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(landscape));
      return;
    }

    // ── 触发衰减维护（含 M6 自我模型维护） ──
    if (req.method === 'POST' && url.pathname === '/api/maintenance/decay') {
      const result = storage.runDecayMaintenance();
      m6?.maintenance();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', ...result }));
      return;
    }

    // ── 触发实体关系图构建 ──
    if (req.method === 'POST' && url.pathname === '/api/maintenance/relations') {
      inductionScheduler?.triggerEntityRelations();
      const relations = storage.getEntityRelationSummary();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok', count: relations.length, relations }));
      return;
    }

    // ── 查看实体关系图 ──
    if (req.method === 'GET' && url.pathname === '/api/relations') {
      const relations = storage.getEntityRelationSummary();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ count: relations.length, relations }));
      return;
    }

    // ── 家族图谱 ──
    if (req.method === 'GET' && url.pathname === '/api/family') {
      const summary = await familyGraph.getFamilySummary().catch(() => ({ members: [], locations: [] }));
      res.writeHead(200); res.end(JSON.stringify(summary));
      return;
    }

    // ── 全模块数据 M5-M8 ──
    if (req.method === 'GET' && url.pathname === '/api/modules') {
      // M6: 自我模型（使用编排器代理方法，替代直接访问 manager）
      const m6Model = m6?.getModel();
      const m6Traits = m6?.getTraits() ?? getSelfModel().traits;
      const m6Prefs = m6?.getPreferences() ?? [];
      const m6Bounds = m6?.getBoundaries() ?? [];
      const m6Layers = m6?.getNarrativeLayers() ?? [];

      // M7: 梦境（从活跃的 DreamQueue 读取）
      const m7Pending = m7?.queue?.getPending() ?? [];
      const m7All = m7?.queue?.getByStatus?.('confirmed') ?? [];
      const m7Logs = clueTracker?.getLogs() ?? [];

      // M8: 年轮 — 从融合存储的地标视图读取
      const landscape = storage.getEmotionalLandscape();
      const m8Status = storage.getSQLite().getStatus();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        m6: {
          traits: m6Traits,
          preferences: m6Prefs.slice(0, 10),
          boundaries: m6Bounds.slice(0, 10),
          narrative_layers: m6Layers.slice(0, 5),
          version: m6Model?.version ?? '1.0',
        },
        m7: {
          pending_dreams: m7Pending.slice(0, 10),
          total_pending: m7Pending.length,
          total_confirmed: m7All.length,
          interaction_logs: m7Logs.slice(-10),
          total_logs: m7Logs.length,
          research_stats: topicTracker?.getStats?.() ?? { tracked: 0, pendingResearch: 0, researched: 0 },
        },
        m8: {
          total_entries: m8Status.landmarks,
          total_scars: landscape.scars.length,
          healed_scars: 0,
          unhealed_scars: landscape.scars.length,
          recent_entries: landscape.peaks.slice(0, 5).map(p => ({
            id: p.id,
            sensory_anchor: p.snippet?.substring(0, 20) ?? '',
            created_at: p.created_at,
            narrative_tag: p.narrative_tag ?? '日常',
            calcium: p.calcium,
          })),
        },
      }));
      return;
    }

    // ── 角色切换 ──
    if (url.pathname === '/api/personas') {
      if (req.method === 'GET') {
        const active = PersonaRegistry.getActive();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          active: active?.id ?? 'yuyao',
          list: PersonaRegistry.list().map(p => ({ id: p.id, name: p.name, description: p.description })),
        }));
        return;
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const ok = PersonaRegistry.setActive(body.persona);
        if (ok) {
          const p = PersonaRegistry.getActive();
          if (p) llmProvider.setPersona(p);
          console.log(`[Persona] 切换到: ${body.persona}`);
          // 切换角色时清空对话历史，避免遗留上下文
          resetConversationHistory();
        }
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok, active: PersonaRegistry.getActive()?.id ?? 'yuyao' }));
        return;
      }
    }

    // ── 秘书功能 ──
    if (url.pathname === '/api/secretary') {
      if (req.method === 'GET') {
        if (url.searchParams.get('tool') === 'calendar') {
          const result = await ToolRegistry.execute('calendar', 'list', {});
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, data: result }));
          return;
        }
        if (url.searchParams.get('tool') === 'reminder') {
          const result = await ToolRegistry.execute('reminder', 'list', {});
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, data: result }));
          return;
        }
        if (url.searchParams.get('tool') === 'note') {
          const result = await ToolRegistry.execute('note', 'list', {});
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, data: result }));
          return;
        }
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const result = await taskAgent.execute(body.message || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
        return;
      }
    }

    // ── 知识库 ──
    // 向量搜索调试
    if (req.method === 'GET' && url.pathname === '/api/knowledge/vector-search') {
      const q = url.searchParams.get('q') || '';
      if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'q required' })); return; }
      const engine = (knowledgeBase as any)['engine'] || knowledgeBase;
      const provider = engine.embedProvider;
      if (!provider?.isAvailable?.()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hits: [], note: '嵌入 API 不可用，请设置 DEEPSEEK_API_KEY' }));
        return;
      }
      const queryVec = await provider.embed(q);
      if (queryVec.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hits: [], note: '嵌入返回空向量' }));
        return;
      }
      const hits = engine.vectorSearchDebug(queryVec, 10);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ query: q, hits }));
      return;
    }

    // 文件上传（multipart）
    if (req.method === 'POST' && url.pathname === '/api/knowledge/upload') {
      let fileBuffer: Buffer | null = null;
      let fileName = '';
      let mimeType = '';

      try {
        await new Promise<void>((resolve, reject) => {
          const bb = busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
          bb.on('file', (_fieldname: string, stream: any, info: { filename: string; mimeType: string }) => {
            fileName = info.filename;
            mimeType = info.mimeType;
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
            stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
          });
          bb.on('finish', () => resolve());
          bb.on('error', (err: Error) => reject(err));
          req.pipe(bb);
        });

        const fb = fileBuffer as Buffer | null;
        if (!fb || fb.length === 0) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'empty file' })); return;
        }

        const entry = await knowledgeBase.upload(fb, fileName, mimeType);
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(entry));
      } catch (err: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message || 'upload failed' }));
      }
      return;
    }

    // Excel 编辑 API（从上传目录读取原始文件）
    if (req.method === 'POST' && url.pathname === '/api/knowledge/excel-query') {
      const body = JSON.parse(await readBody(req));
      const { knId, sheet, row, col, value } = body;
      const entry = knowledgeBase.getById(knId);
      if (!entry || !['xlsx', 'xls', 'csv'].includes(entry.source_type)) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'not found or not an excel file' }));
        return;
      }
      try {
        // 从上传目录查找原始 Excel 文件
        const uploadDir = path.join(DATA_DIR, 'uploads');
        let excelBuffer: Buffer | null = null;
        if (existsSync(uploadDir)) {
          const files = fs.readdirSync(uploadDir);
          // 找与条目 ID 关联的文件（source_name 匹配）
          const match = files.find(f => f.includes(entry.title.replace(/[^a-zA-Z0-9._-]/g, '_')));
          if (match) {
            excelBuffer = fs.readFileSync(path.join(uploadDir, match));
          }
        }
        if (!excelBuffer) {
          // 尝试从 content 中的文本重建（纯文本回退）
          res.writeHead(400); res.end(JSON.stringify({ error: '原始Excel文件未找到，请重新上传' }));
          return;
        }
        const { sheets } = excelToJson(excelBuffer);
        if (sheet !== undefined) {
          if (row !== undefined && col !== undefined && value !== undefined) {
            // 编辑模式：修改单元格
            const ws = sheets[sheet];
            if (ws === undefined) { res.writeHead(400); res.end(JSON.stringify({ error: 'sheet not found' })); return; }
            while (ws.data.length <= row) ws.data.push([]);
            while (ws.data[row].length <= col) ws.data[row].push('');
            ws.data[row][col] = value;
            const newBuf = jsonToExcel(sheets);
            // 覆盖原始文件
            const uploadDir2 = path.join(DATA_DIR, 'uploads');
            const files2 = fs.readdirSync(uploadDir2);
            const match2 = files2.find(f => f.includes(entry.title.replace(/[^a-zA-Z0-9._-]/g, '_')));
            if (match2) fs.writeFileSync(path.join(uploadDir2, match2), newBuf);
            // 更新知识库文本内容
            const textContent = await parseFile(newBuf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', entry.source_name || 'data.xlsx');
            await knowledgeBase.update(knId, { title: entry.title, content: textContent.content });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          // 查询模式：返回指定 sheet 数据
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sheet: sheets[sheet] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sheets }));
      } catch (err: any) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (url.pathname === '/api/knowledge') {
      // GET: 列表 / POST: 新增 / DELETE: 删除
      if (req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const keyword = url.searchParams.get('search') || '';
        const list = keyword ? await knowledgeBase.search(keyword, limit) : knowledgeBase.list(limit);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ total: list.length, items: list }));
        return;
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        if (!body.title || !body.content) { res.writeHead(400); res.end(JSON.stringify({error:'title and content required'})); return; }
        const entry = await knowledgeBase.add({
          title: body.title, content: body.content,
          source_type: body.source_type ?? 'text', source_name: body.source_name ?? null,
          file_size: body.file_size ?? 0, tags: body.tags ?? [],
        });
        res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(entry));
        return;
      }
      if (req.method === 'DELETE') {
        const body = JSON.parse(await readBody(req));
        if (!body.id) { res.writeHead(400); res.end(JSON.stringify({error:'id required'})); return; }
        const ok = knowledgeBase.delete(body.id);
        res.writeHead(ok ? 200 : 404);
        res.end(JSON.stringify({ status: ok ? 'deleted' : 'not_found' }));
        return;
      }
    }

    // 知识库单条目操作（编辑）
    const knMatch = url.pathname.match(/^\/api\/knowledge\/(kn_[a-z0-9_]+)$/);
    if (knMatch && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      const ok = await knowledgeBase.update(knMatch[1], {
        title: body.title, content: body.content, tags: body.tags, locked: body.locked,
      });
      res.writeHead(ok ? 200 : 404);
      res.end(JSON.stringify({ status: ok ? 'updated' : 'not_found_or_locked' }));
      return;
    }

    // ── API Key 管理 ──
    if (url.pathname === '/api/keys') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ keys: listKeys() }));
        return;
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        if (!body.name || !body.value) { res.writeHead(400); res.end(JSON.stringify({ error: 'name and value required' })); return; }
        const result = setKey(body.name, body.value, body.label);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, key: result }));
        return;
      }
      if (req.method === 'DELETE') {
        const body = JSON.parse(await readBody(req));
        if (!body.name) { res.writeHead(400); res.end(JSON.stringify({ error: 'name required' })); return; }
        const ok = deleteKey(body.name);
        res.writeHead(ok ? 200 : 404);
        res.end(JSON.stringify({ ok }));
        return;
      }
    }

    // ── M3 词表命中统计 ──
    if (req.method === 'GET' && url.pathname === '/api/m3/hits') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ hits: getHitReport() }));
      return;
    }

    // ── TTS 音频文件 ──
    if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
      const fileName = path.basename(url.pathname);
      const audioPath = path.join(DATA_DIR, 'audio', fileName);
      // 安全检查：确保文件在 audio 目录内
      if (!audioPath.startsWith(path.join(DATA_DIR, 'audio'))) { res.writeHead(403); res.end('403'); return; }
      if (existsSync(audioPath)) {
        const ext = path.extname(fileName).toLowerCase();
        const mime: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg' };
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': 'max-age=3600',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(fs.readFileSync(audioPath));
        return;
      }
      res.writeHead(404); res.end('404');
      return;
    }

    res.writeHead(404); res.end('404');
  } catch (err: any) {
    console.error('[WebUI] Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
  }
}

async function main(): Promise<void> {
  await initPipeline();
  console.log('  玉瑶 · 太虚境 WebUI 初始化完成 ✓');

  // ── 关闭钩子：刷出工作记忆 ──
  let shuttingDown = false;
  async function handleShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Server] 收到 ${signal}，正在刷出工作记忆...`);
    try {
      const flushed = await workingMemory.flushAll();
      console.log(`[Server] 已刷出 ${flushed.length} 条工作记忆`);
    } catch (err) {
      console.error('[Server] 刷出失败:', err);
    }
    // 确保数据落盘
    flushConversationHistory();
    try { storage?.getSQLite()?.flush(); } catch {}
    console.log('[Server] 数据已落盘');
    process.exit(0);
  }
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║    玉瑶 · 太虚境  WebUI              ║');
    console.log('  ║                                      ║');
    console.log(`  ║   http://localhost:${PORT}               ║`);
    console.log('  ║                                      ║');
    console.log('  ║   /api/chat   聊天+M1-M5数据         ║');
    console.log('  ║   /api/modules M6-M8全模块数据       ║');
    console.log('  ║   /api/reset  重置                  ║');
    console.log('  ║   /api/search 线索检索              ║');
    console.log('  ║   Ctrl+C     退出                   ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
  });
}
main().catch(err => { console.error('启动失败:', err); process.exit(1); });
