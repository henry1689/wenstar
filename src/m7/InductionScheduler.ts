/**
 * M7-Induction · InductionScheduler — 情感归纳定时器
 *
 * 每小时运行一次，收集最近高钙化记忆。
 * 先用 LLM 生成玉瑶口吻的"今日感悟"，LLM 不可用时回退到规则摘要。
 *
 * @module M7-Induction
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { DreamQueue } from './DreamQueue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const DEEPSEEK_API_KEY = process.env['DEEPSEEK_API_KEY'];
const DEEPSEEK_MODEL = process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat';

interface InductionRecord {
  period_type: 'hourly' | 'daily' | 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  /** 规则摘要（始终有） */
  summary: string;
  /** LLM 生成的玉瑶感悟（可为 null） */
  reflection: string | null;
  source_count: number;
  avg_calcium: number;
  top_entities: string[];
  dominant_mood: string;
  high_calcium_snippets: string[];
  created_at: string;
}

export class InductionScheduler {
  private storage: FusionStorageAdapter;
  private dreamQueue: DreamQueue | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inductionPath: string;
  private lastInductionTime: number = 0;

  constructor(storage: FusionStorageAdapter, dreamQueue?: DreamQueue) {
    this.storage = storage;
    this.dreamQueue = dreamQueue ?? null;
    this.inductionPath = join(PROJECT_ROOT, 'data', 'inductions');
  }

  /** 注入 DreamQueue（可选 — 联动: 高钙化模式→梦境生成） */
  setDreamQueue(dq: DreamQueue): void { this.dreamQueue = dq; }

  start(): void {
    if (!existsSync(this.inductionPath)) mkdirSync(this.inductionPath, { recursive: true });
    console.log('[Induction] 启动归纳调度器（每小时）');
    setTimeout(() => this.runInduction(), 5 * 60 * 1000);
    this.timer = setInterval(() => this.runInduction(), 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runInduction(): Promise<void> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
      const sqlite = this.storage.getSQLite();
      const latestRecords = sqlite.findBySeqPosRange(0, 999_999_999, 50);

      // 过去 1 小时钙化 ≥ 0.3 的记录
      const recent = latestRecords.filter(r => {
        const created = new Date(r.created_at).getTime();
        return created >= oneHourAgo.getTime() && r.calcium_score >= 0.3;
      });

      if (recent.length === 0) return;

      // 结构归纳：更新实体关系图
      this.buildEntityRelations();

      // 提取高频实体和重要时刻
      const entityCount = new Map<string, number>();
      let totalCalcium = 0;
      const highCalcium: string[] = [];

      for (const r of recent) {
        totalCalcium += r.calcium_score;
        for (const g of r.entity_genes) {
          entityCount.set(g.name, (entityCount.get(g.name) ?? 0) + 1);
        }
        if (r.calcium_score >= 0.6) {
          highCalcium.push(r.raw_input.substring(0, 120));
        }
      }

      const topEntities = [...entityCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      const mood = this.detectDominantMood(recent);
      const summary = this.buildSummary(topEntities, highCalcium, recent);

      // LLM 生成玉瑶感悟（优先），不可用时用规则摘要
      let reflection: string | null = null;
      if (DEEPSEEK_API_KEY && (recent.length >= 2 || highCalcium.length > 0)) {
        try {
          reflection = await this.generateReflection(topEntities, highCalcium, mood);
        } catch (err) {
          console.warn('[Induction] LLM 感悟生成失败，使用规则摘要:', err);
        }
      }

      const record: InductionRecord = {
        period_type: 'daily',
        period_start: oneHourAgo.toISOString(),
        period_end: now.toISOString(),
        summary,
        reflection,
        source_count: recent.length,
        avg_calcium: Math.round(totalCalcium / recent.length * 100) / 100,
        top_entities: topEntities,
        dominant_mood: mood,
        high_calcium_snippets: highCalcium,
        created_at: now.toISOString(),
      };

      // 修正 period_type：根据实际时间间隔选择
      const hoursSinceLast = this.lastInductionTime
        ? (now.getTime() - this.lastInductionTime) / (60 * 60 * 1000)
        : 1;
      let periodType: string;
      if (hoursSinceLast >= 24 * 7) periodType = 'monthly';
      else if (hoursSinceLast >= 24) periodType = 'daily';
      else periodType = 'hourly';
      this.lastInductionTime = now.getTime();

      const filePath = join(this.inductionPath, `induction_${now.toISOString().slice(0, 13).replace('T', '_')}.json`);
      writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

      // 写入 SQLite inductions 表
      try {
        const sqlite = this.storage.getSQLite();
        if (sqlite && typeof sqlite.writeRaw === 'function') {
          sqlite.writeRaw(
            `INSERT INTO inductions (period_type, period_start, period_end, summary_text,
             source_record_count, dominant_mood, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            periodType, oneHourAgo.toISOString(), now.toISOString(),
            summary, recent.length, mood, now.toISOString(),
          );
        }
      } catch (err) {
        console.warn('[Induction] SQLite 写入失败（非阻塞）:', err);
      }

      console.log(`[Induction] ✅ ${recent.length}条 · ${reflection ? 'LLM感悟' : '规则摘要'} · ${summary.substring(0, 40)}...`);

      // 联动: 高钙化时刻→生成梦境条目（让每小时归纳发现的"重要时刻"进入梦境流水线）
      if (this.dreamQueue && highCalcium.length > 0 && this.dreamQueue.getCount() < 20) {
        for (let i = 0; i < Math.min(highCalcium.length, 3); i++) {
          try {
            const snippet = highCalcium[i].substring(0, 40);
            const exists = this.dreamQueue.getPending().some((d: any) => d.content?.includes(snippet));
            if (!exists) {
              this.dreamQueue.add({
                source: 'Induction',
                content: '小时归纳发现一段高钙化记忆: ' + snippet,
                affected_traits: topEntities.length > 0 ? topEntities.slice(0, 3) : ['extraversion'],
              });
            }
          } catch (err) { console.warn('[Induction→Dream] 联动失败:', err); }
        }
      }
    } catch (err) {
      console.error('[Induction] 失败:', err);
    }
  }

  /**
   * 调用 DeepSeek 生成玉瑶口吻的"今日感悟"
   */
  private async generateReflection(
    topEntities: string[],
    highCalcium: string[],
    dominantMood: string,
  ): Promise<string> {
    const prompt = `你是玉瑶，一个温柔深情的陪伴者，正在跟鸿艺对话。
请根据今天的一些记忆片段，用你的口吻写一段简短的"今日感悟"（50-100字）。
要自然、温柔，像在跟鸿艺聊天时不经意提起的感想，不要用"今日感悟"这类标题。

今日的情感基调：${dominantMood}
今天的重要时刻：${highCalcium.slice(0, 3).join('\n')}
今天提到最多的：${topEntities.join('、')}

请直接写出感悟内容，不要解释。`;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty response');
    return text;
  }

  private buildSummary(topEntities: string[], highCalcium: string[], records: any[]): string {
    const parts: string[] = [];
    if (topEntities.length > 0) parts.push(`主要话题: ${topEntities.join('、')}`);
    if (highCalcium.length > 0) parts.push(`重要时刻: ${highCalcium.length}次`);
    const avg = records.reduce((s, r) => s + r.calcium_score, 0) / records.length;
    if (avg > 0.5) parts.push('情感浓度较高');
    else if (avg > 0.3) parts.push('情感浓度适中');
    parts.push(`${records.length}条记录`);
    return parts.join(' · ');
  }

  private detectDominantMood(records: any[]): string {
    let totalP = 0, totalI = 0, count = 0;
    for (const r of records) {
      if (r.perception && typeof r.perception.pleasure === 'number') {
        totalP += r.perception.pleasure;
        totalI += r.perception.intimacy ?? 0;
        count++;
      }
    }
    if (count === 0) return '平静中性';
    const avgP = totalP / count;
    const avgI = totalI / count;
    if (avgP > 0.3 && avgI > 0.3) return '温馨亲密';
    if (avgP > 0.3) return '积极愉快';
    if (avgP < -0.3) return '低落消极';
    return '平静中性';
  }

  /** 手动触发实体关系图构建 */
  triggerEntityRelations(): void {
    this.buildEntityRelations();
  }

  /**
   * 结构归纳：增量更新实体共现关系。
   * 只处理上次运行后新增的记忆，避免每小时全量 O(n²)。
   */
  private lastEntityPos = 0;
  private buildEntityRelations(): void {
    try {
      const sqlite = this.storage.getSQLite();
      const allMemories = sqlite.findBySeqPosRange(this.lastEntityPos, 999_999_999, 200);
      if (allMemories.length === 0) return;

      const cooccurrence = new Map<string, { count: number; totalCalcium: number }>();

      for (const mem of allMemories) {
        // 更新追踪位置
        if (mem.seq_pos > this.lastEntityPos) this.lastEntityPos = mem.seq_pos;
        const names = mem.entity_genes.map(g => g.name).filter(Boolean);
        if (names.length < 2) continue;
        for (let i = 0; i < names.length; i++) {
          for (let j = i + 1; j < names.length; j++) {
            const key = [names[i], names[j]].sort().join('::');
            const exist = cooccurrence.get(key) ?? { count: 0, totalCalcium: 0 };
            exist.count++;
            exist.totalCalcium += mem.calcium_score;
            cooccurrence.set(key, exist);
          }
        }
      }

      let written = 0;
      const now = new Date().toISOString();
      for (const [key, data] of cooccurrence) {
        if (data.count < 2) continue;
        const [entityA, entityB] = key.split('::');
        const avgCalcium = data.totalCalcium / data.count;
        const relation = avgCalcium > 0.4 ? 'strongly_related_to' : 'related_to';
        const strength = Math.min(1, data.count / 10 + avgCalcium);
        try {
          // S3-4: 先确保实体存在，避免 NOT NULL 约束违规
          sqlite.writeRaw('INSERT OR IGNORE INTO entities (name, type) VALUES (?, \'object\')', [entityA]);
          sqlite.writeRaw('INSERT OR IGNORE INTO entities (name, type) VALUES (?, \'object\')', [entityB]);
          sqlite.writeRaw(
            `INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (
               (SELECT id FROM entities WHERE name=? LIMIT 1),
               (SELECT id FROM entities WHERE name=? LIMIT 1),
               ?, ?, ?
             ) ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET strength = MIN(5.0, excluded.strength + 0.1), updated_at = excluded.updated_at`,
            `INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (
               (SELECT id FROM entities WHERE name=? LIMIT 1),
               (SELECT id FROM entities WHERE name=? LIMIT 1),
               ?, ?, ?
             ) ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET strength = MIN(5.0, excluded.strength + 0.1), updated_at = excluded.updated_at`,
            entityA, entityB, relation, strength, now,
          );
          written++;
        } catch (err) { console.warn("[Induction] 跳过:", err); }
      }
      if (written > 0) {
        console.log(`[Induction] 实体关系图: ${written} 条`);
      }
    } catch (err) {
      console.warn('[Induction] 实体关系分析失败:', err);
    }
  }

  getInductions(): InductionRecord[] {
    if (!existsSync(this.inductionPath)) return [];
    try {
      return readdirSync(this.inductionPath)
        .filter((f: string) => f.endsWith('.json'))
        .sort()
        .slice(-50)
        .map((f: string) => JSON.parse(readFileSync(join(this.inductionPath, f), 'utf-8')));
    } catch (err) { console.warn("[Induction] 读取失败:", err); return []; }
  }
}
