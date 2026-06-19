// M7-Dream · M7Orchestrator — 梦境空闲时段批量处理
// Ref: docs/M7-design-v1.md §3-§6
// @module M7-Dream

import { DreamQueue } from './DreamQueue.js';
import { DreamInternalizer } from './DreamInternalizer.js';
import { ClueTracker } from './ClueTracker.js';
import type { PendingDream } from './types/index.js';
import type { KnowledgeBase } from '../m2/KnowledgeBase.js';
import type { M6Orchestrator } from '../m6/M6Orchestrator.js';
import crypto from 'node:crypto';
import type { FamilyGraph } from '../m4/FamilyGraph.js';
import type { TopicTracker } from '../app/knowledge/TopicTracker.js';
import type { M8Engine } from '../m8/M8Engine.js';

/**
 * M7 空闲批处理定时器
 * - 每 60s 处理梦境队列（如果有待处理梦）
 * - 每 5 分钟独立运行 4 维梦境分析（队列为空时也执行）
 */
export function startM7Interval(m7: M7Orchestrator, intervalMs: number = 60000): NodeJS.Timeout {
  let dreamAnalysisTimer = Date.now();
  const DREAM_ANALYSIS_INTERVAL = 5 * 60 * 1000; // 1分钟（调试期间）

  return setInterval(async () => {
    try {
      // 1. 处理梦境队列
      if (m7.shouldProcessQueue()) {
        const result = await m7.processIdle();
        console.log(`[M7] 梦境批处理: ${result.internalized} 条`);
        m7.cleanResolvedQueue();
      }

      // 2. 独立运行四维梦境分析（不受队列状态影响）
      const now = Date.now();
      if (now - dreamAnalysisTimer >= DREAM_ANALYSIS_INTERVAL) {
        dreamAnalysisTimer = now;
        await m7.processDreamAnalysis();
      }
    } catch (err) {
      console.error('[M7] 批处理失败:', err);
    }
  }, intervalMs);
}

export class M7Orchestrator {
  private knowledgeBase: KnowledgeBase | null = null;
  private m6: M6Orchestrator | null = null;
  private familyGraph: FamilyGraph | null = null;
  private topicTracker: TopicTracker | null = null;
  private _storageRef: any = null;
  /** @deprecated 请通过编排器代理方法访问（shouldProcessQueue/cleanResolvedQueue/getPendingDreams 等） */
  public queue: DreamQueue;
  /** @deprecated 请通过编排器代理方法访问 */
  public internalizer: DreamInternalizer;
  /** @deprecated 请通过编排器代理方法访问 */
  public tracker: ClueTracker;

  constructor(m8: M8Engine, deps?: {
    knowledgeBase?: KnowledgeBase;
    m6?: M6Orchestrator;
    familyGraph?: FamilyGraph;
    topicTracker?: TopicTracker;
    storageRef?: any;
  }) {
    this.queue = new DreamQueue();
    this.internalizer = new DreamInternalizer(this.queue, m8);
    this.tracker = new ClueTracker();
    if (deps) {
      this.knowledgeBase = deps.knowledgeBase ?? null;
      this.m6 = deps.m6 ?? null;
      this.familyGraph = deps.familyGraph ?? null;
      this.topicTracker = deps.topicTracker ?? null;
      this._storageRef = deps.storageRef ?? null;
    }
  }

  /** 延迟注入 M6 */
  setM6(m6: M6Orchestrator): void {
    this.internalizer.setM6(m6);
    this.m6 = m6;
  }

  /** 空闲时段批处理 */
  async processIdle(): Promise<{ internalized: number; advice: string[] }> {
    const results = await this.internalizer.internalizeBatch();
    this.internalizer.discardStale();
    const advice = this.tracker.generateAdvice();
    await this.runDreamModules();
    return { internalized: results.length, advice };
  }

  /** 独立运行四维梦境分析（从定时器调用，不受队列状态影响） */
  async processDreamAnalysis(): Promise<void> {
    await this.runDreamModules();
  }

  /** 四维梦境分析（串行，独立容错） */
  private async runDreamModules(): Promise<void> {
    await this.summarizeHighEmotionMemory().catch(e => console.warn('[Dream] 情感雷达失败:', e));
    await this.linkHotTopics().catch(e => console.warn('[Dream] 话题关联失败:', e));
    await this.extractUserPrefAndOptimizeSelf().catch(e => console.warn('[Dream] 自我进化失败:', e));
    await this.digImportantPersonEvent().catch(e => console.warn('[Dream] 人物复盘失败:', e));
  }

  // ─── 代理方法（收敛对外部引擎的直接访问） ───

  shouldProcessQueue(): boolean { return this.queue.shouldProcess(); }
  cleanResolvedQueue(): void { this.queue.cleanResolved(); }
  getPendingDreams(): PendingDream[] { return this.queue.getPending(); }
  getDreamCount(): number { return this.queue.getCount(); }
  addDream(dream: Omit<PendingDream, 'id' | 'created_at' | 'status'>): PendingDream {
    return this.queue.add(dream);
  }
  getDreamsByStatus(status: PendingDream['status']): PendingDream[] {
    return this.queue.getByStatus(status);
  }

  // ═══════════════════════════════════════════════════════════════
  // 梦境深化四模块（新增，空闲时执行）
  // ═══════════════════════════════════════════════════════════════

  // 各模块每天只运行一次的日期标记
  private _lastRunDate: Record<string, string> = {};

  /** 检查模块当天是否已运行 */
  private alreadyRanToday(moduleKey: string): boolean {
    const today = new Date().toISOString().substring(0, 10);
    if (this._lastRunDate[moduleKey] === today) return true;
    this._lastRunDate[moduleKey] = today;
    return false;
  }

  /** Module 1: 高情绪事件归纳 + 共情自动提升 */
  private async summarizeHighEmotionMemory(): Promise<void> {
    if (this.alreadyRanToday('m1')) return;
    const storage = this._storageRef;
    if (!storage) return;
    try {
      const sqlite = typeof storage.getSQLite === 'function' ? storage.getSQLite() : null;
      if (!sqlite) return;

      // 去重：当天已有梦境数据则跳过
      const today = new Date().toISOString().substring(0, 10);
      const existing = sqlite.queryAll(
        'SELECT id FROM black_diamond WHERE tags LIKE ? AND created_at LIKE ?',
        '%dream_high_emotion%', today + '%'
      );
      if (existing && existing.length > 0) return;

      const all = sqlite.queryAll('SELECT id, raw_input, calcium_level, calcium_score, perception_json FROM memories ORDER BY created_at DESC LIMIT 200');
      if (!all || all.length === 0) return;

      // 筛选高情绪记忆（钙质≥0.4）
      const highEmo = all.filter((r: any) => (r.calcium_score || 0) >= 0.4);
      if (highEmo.length === 0) return;

      // 按情绪类型分组
      const groups: Record<string, { count: number; samples: string[] }> = {};
      for (const mem of highEmo) {
        const perc = mem.perception_json ? JSON.parse(mem.perception_json) : {};
        const p = perc.pleasure || 0;
        const label = p < -0.3 ? '低落' : p > 0.3 ? '积极' : '强烈';
        if (!groups[label]) groups[label] = { count: 0, samples: [] };
        groups[label].count++;
        if (groups[label].samples.length < 3) groups[label].samples.push((mem.raw_input || '').substring(0, 60));
      }

      // 保存到黑钻
      for (const [emotion, data] of Object.entries(groups)) {
        const now = new Date().toISOString();
        const summary = '【梦境】高情绪_' + emotion + ': ' + data.count + '次 · ' + data.samples.join(' | ');
        sqlite.writeRaw(
          'INSERT OR IGNORE INTO black_diamond (id, summary, emotion_tag, source_id, calcium_level, tags, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          'dh_' + crypto.createHash('md5').update(summary).digest('hex').substring(0, 12),
          summary, emotion, 'dream_high_emotion', 2,
          JSON.stringify(['dream_high_emotion', emotion, '梦境自动沉淀']),
          '梦境情感雷达于 ' + now, now, now
        );
      }
      console.log('[Dream] 情感雷达: ' + highEmo.length + ' 条高情绪, ' + Object.keys(groups).length + ' 类');
    } catch (err) {
      console.warn('[Dream] 情感雷达分析失败:', err);
    }
  }

  /** Module 2: 高频话题关联 + 联网搜索 + 存入知识库（含向量） */
  private async linkHotTopics(): Promise<void> {
    const kb = this.knowledgeBase;
    if (!kb || !this.topicTracker) return;
    try {
      const topics = typeof this.topicTracker.getTopicsNeedingResearch === 'function'
        ? this.topicTracker.getTopicsNeedingResearch()
        : [];
      if (!topics || topics.length === 0) return;

      for (const topic of topics.slice(0, 3)) {
        // 查知识库是否已有相关内容
        const existing = await kb.search(topic, 1);
        if (existing && existing.length > 0) continue;

        // 联网搜索（复用 WebResearchService）
        let researchContent = '';
        let sourceName = '玉瑶梦境调研';
        try {
          const { researchTopic } = await import('../app/knowledge/WebResearchService.js');
          const result = await researchTopic(topic, null as any);
          if (result && result.summary) {
            researchContent = result.summary;
            sourceName = result.sources?.join(',') || '玉瑶梦境调研';
          }
        } catch { /* 搜索失败，用默认内容 */ }

        if (!researchContent) {
          researchContent = `关于「${topic}」的研究笔记\n研究时间：${new Date().toLocaleString('zh-CN')}\n来源：玉瑶的自主知识整理\n\n这是玉瑶在空闲时对主人常提起的「${topic}」做的资料整理。主人对这个话题很感兴趣，玉瑶会继续关注相关内容，在下次主人提起时和主人一起探讨。`;
        }

        // 存入系统知识库（自动分块 + 向量嵌入，就像把书放上书架）
        await kb.add({
          title: '📚 ' + topic,
          content: researchContent,
          source_type: 'dream_research',
          tags: ['dream_research', 'web_research', topic],
          classification: '梦境研究',
          interaction_type: 'document',
        });
        console.log('[Dream] 话题调研完成: ' + topic);
      }
    } catch (err) {
      console.warn('[Dream] 话题关联失败:', err);
    }
  }

  /** Module 3: 用户偏好提取 + 自我模型优化 */
  private async extractUserPrefAndOptimizeSelf(): Promise<void> {
    if (this.alreadyRanToday('m3')) return;
    const storage = this._storageRef;
    const m6 = this.m6;
    if (!storage || !m6) return;
    try {
      const sqlite = typeof storage.getSQLite === 'function' ? storage.getSQLite() : null;
      if (!sqlite) return;

      // 扫描最近对话，提取用户对玉瑶的评价信号
      const recent = sqlite.queryAll('SELECT id, raw_input, perception_json FROM memories ORDER BY created_at DESC LIMIT 100');
      if (!recent || recent.length === 0) return;

      // 检测用户对玉瑶的反馈信号
      let positiveCount = 0;
      let negativeCount = 0;
      const posKeywords = ['温柔','贴心','懂我','可爱','真好','喜欢','舒服','棒','厉害'];
      const negKeywords = ['生硬','冷淡','啰嗦','不对','别这样','不好','差'];

      for (const mem of recent) {
        const text = (mem.raw_input || '').toLowerCase();
        for (const kw of posKeywords) {
          if (text.includes(kw)) { positiveCount++; break; }
        }
        for (const kw of negKeywords) {
          if (text.includes(kw)) { negativeCount++; break; }
        }
      }

      // 如果有明显的正/负反馈，更新 M6
      if (positiveCount > 0 || negativeCount > 0) {
        console.log('[Dream] 自我进化: 正向反馈 ' + positiveCount + ', 负向 ' + negativeCount);
        // 正向多→提升 agreeableness（宜人性）
        if (positiveCount > negativeCount * 2 && positiveCount >= 3) {
          m6.applyConfirmed('agreeableness', 'increase', 3);
        }
        // 负向多→不调整，仅记录
        if (negativeCount > positiveCount && negativeCount >= 3) {
          console.log('[Dream] 检测到负向反馈较多，建议检查回复风格');
        }
      }

      // 记录本轮优化日志到黑钻
      if (positiveCount + negativeCount > 0) {
        const now = new Date().toISOString();
        sqlite.writeRaw(
          'INSERT OR IGNORE INTO black_diamond (id, summary, emotion_tag, source_id, calcium_level, tags, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          'de_' + crypto.createHash('md5').update('【梦境自我优化】正向反馈' + positiveCount + '次, 负向' + negativeCount + '次').digest('hex').substring(0, 12),
          '【梦境自我优化】正向反馈' + positiveCount + '次, 负向' + negativeCount + '次',
          '中性', 'dream_evolution', 1,
          JSON.stringify(['dream_evolution', 'self_optimize']),
          '梦境自动记录于 ' + now, now, now
        );
      }
    } catch (err) {
      console.warn('[Dream] 自我进化失败:', err);
    }
  }

  /** Module 4: 重要人物/事件复盘摘要 */
  private async digImportantPersonEvent(): Promise<void> {
    if (this.alreadyRanToday('m4')) return;
    const fg = this.familyGraph;
    const kb = this.knowledgeBase;
    const storage = this._storageRef;
    if (!fg || !kb || !storage) return;
    try {
      const sqlite = typeof storage.getSQLite === 'function' ? storage.getSQLite() : null;
      if (!sqlite) return;

      // 从 FamilyGraph 读取所有人名
      // 直接查家庭图谱数据库
      const persons = sqlite.queryAll("SELECT name, properties FROM nodes WHERE type = 'person' AND name != '我'");
      if (!persons || persons.length === 0) return;

      for (const person of persons) {
        const name = person.name;
        // 检查知识库中是否已有此人物的梦境摘要
        const existing = await kb.search('人物梦境: ' + name, 1);
        if (existing && existing.length > 0) continue;

        // 在 memories 中搜索提及此人物的记录
        const mentions = sqlite.queryAll(
          'SELECT raw_input, calcium_score, created_at FROM memories WHERE raw_input LIKE ? ORDER BY created_at DESC LIMIT 10',
          ['%' + name + '%']
        );
        if (!mentions || mentions.length < 2) continue;

        // 生成摘要
        const totalMentions = mentions.length;
        const avgCalcium = mentions.reduce((s: number, m: any) => s + (m.calcium_score || 0), 0) / totalMentions;
        const latestCtx = mentions[0]?.raw_input?.substring(0, 100) || '';
        const summary = name + '：对话中提到' + totalMentions + '次，情感强度' + avgCalcium.toFixed(2) + '。最近提及：' + latestCtx;

        // 存入知识库
        await kb.add({
          title: '人物梦境: ' + name,
          content: summary,
          source_type: 'dream_person',
          tags: ['dream_person', 'person_summary'],
          classification: '梦境归纳',
          interaction_type: 'other',
        });

        // 更新 FamilyGraph 备注
        if (typeof fg.updateNodeProperties === 'function') {
          try { await fg.updateNodeProperties(name, { 梦境备注: summary.substring(0, 200) }); } catch {}
        }
      }
      console.log('[Dream] 人物复盘完成');
    } catch (err) {
      console.warn('[Dream] 人物复盘失败:', err);
    }
  }

}
