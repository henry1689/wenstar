/**
 * MasterProfileService — 主人大脑镜像服务
 *
 * 双翼架构：
 *   主观世界 — 主人是谁（精神/内心/感官/生活/娱乐/健康/学习）
 *   客观世界 — 主人与世界打交道（工作/人脉/事务/事件）
 *
 * 原则：
 *   - 只记主人主动说的/回答玉瑶问题的
 *   - 每条信息需通过审查关卡（钙质+实体）
 *   - 去重：相同内容更新置信度，不重复插入
 */
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';

// ── 主观世界 8 维度关键词 ──
const SUBJECTIVE_RULES: Array<{ category: string; keywords: RegExp[] }> = [
  { category: 'world_view', keywords: [/我[相认觉]/] },
  { category: 'inner_world', keywords: [/我感(觉|到|受)/, /我(害怕|焦虑|难过|开心|委屈|压[力抑])/, /我[需想]要/, /我(担[心忧]|恐[惧怕])/, /感觉/, /心情/, /有点[烦累忙乱]/] },
  { category: 'sensory', keywords: [/我[喜爱]欢[吃喝听看闻]/, /我觉得(好吃|好听|好看|舒服|爽)/, /好[吃好看]/, /舒服|享受/] },
  { category: 'life', keywords: [/我[家在住]/, /我(平时|每天|经常|习惯)/, /我(的)?日常/, /[我家住]/] },
  { category: 'entertainment', keywords: [/我[喜爱](玩|打|看|追|听)/, /我的(爱[好]?|兴[趣]?)/, /我[在去](健[身]?|运[动]?|游[泳]?|跑[步]?)/, /爱[好]/, /喜欢[玩看]/] },
  { category: 'health', keywords: [/我(生病|失眠|头痛|哪里|不舒服|体[检检]|药)/, /我(睡[不着]?|熬[夜]?)/, /我(最近|一直)(身体|状态)/, /失眠|熬夜|身体|状态不好/] },
  { category: 'learning', keywords: [/我在[学看读]/, /我[学看读](书|课|画|琴|摄影)/, /我最[近]?在[学研究]/, /在学/, /学[画琴摄影]/] },
  { category: 'spiritual', keywords: [/我[相认觉]为/, /我的(原则|信仰|价值观|人生观)/, /我(信仰|相信|觉得人)/] },
];

// ── 客观世界关键词 ──
const OBJECTIVE_RULES: Array<{ table: string; category: string; keywords: RegExp[] }> = [
  { table: 'affairs', category: 'project', keywords: [/项[目]/, /负[责]/, /在[跟做搞]/, /客[户]/, /合[同同]/, /开[会]/, /汇[报]/, /方[案案]/] },
  { table: 'affairs', category: 'decision', keywords: [/考[虑]?[要]?跳[槽]/ , /[在考想]要不要/, /决[定]/, /选[择择]/] },
  { table: 'network', category: 'person', keywords: [/同事/, /客[户]/, /合[作伙]/, /老[板]/, /上[司]/, /朋[友友]/] },
  { table: 'events', category: 'achievement', keywords: [/搞[定]/, /成[功]/, /完[成]/, /拿[下]/, /终[于]/, /毕[业]/, /入[职职]/, /升[职职]/] },
  { table: 'events', category: 'milestone', keywords: [/上[个月]/, /去[年]/, /之[前前]/, /以[前前]/, /第[一]次/, /记[得]/, /有[一]次/] },
];

// ── LLM 辅助分类 prompt ──
const CLASSIFY_PROMPT = (text: string) => {
  const categories = 'world_view(精神)/inner_world(内心)/sensory(感官)/life(生活)/entertainment(娱乐)/health(健康)/learning(学习)/spiritual(精神)';
  const objCategories = 'project(项目)/client(客户)/deal(合同)/decision(决策)/person(人脉)/achievement(成就)/milestone(事件)';
  return `从以下文本中提取关于主人的个人信息，输出JSON。类别(主观世界): ${categories} 类别(客观世界): ${objCategories} 如果不是关于主人的任何个人信息，返回: {"extracted": false} 文本: "${text}" JSON格式: {"extracted": true, "category": "类别", "content": "具体信息"}`;
};

export interface ExtractResult {
  /** 主观世界条目 */
  subjective: Array<{ category: string; subcategory?: string; content: string }>;
  /** 客观世界条目 */
  objective: Array<{ table: 'affairs' | 'network' | 'events'; category: string; content: string; personName?: string }>;
}

export class MasterProfileService {
  private sqlite: SQLiteAdapter;

  constructor(sqlite: SQLiteAdapter) {
    this.sqlite = sqlite;
  }

  /**
   * 提取主人信息（规则匹配 + LLM 辅助）
   */
  async extract(text: string, calciumScore: number, llmGenerate?: (prompt: string) => Promise<string>): Promise<ExtractResult> {
    const result: ExtractResult = { subjective: [], objective: [] };

    // 1. 规则匹配主观世界
    for (const rule of SUBJECTIVE_RULES) {
      if (rule.keywords.some(kw => kw.test(text))) {
        result.subjective.push({ category: rule.category, content: text.substring(0, 100) });
      }
    }

    // 2. 规则匹配客观世界
    for (const rule of OBJECTIVE_RULES) {
      if (rule.keywords.some(kw => kw.test(text))) {
        result.objective.push({ table: rule.table as any, category: rule.category, content: text.substring(0, 100) });
      }
    }

    // 3. LLM 辅助分类（当规则匹配到任何内容时，用 LLM 精确分类）
    if ((result.subjective.length > 0 || result.objective.length > 0) && llmGenerate) {
      try {
        const llmResult = await Promise.race([
          llmGenerate(CLASSIFY_PROMPT(text)),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        const parsed = JSON.parse(llmResult);
        if (parsed.extracted && parsed.category) {
          const isSubjective = ['world_view','inner_world','sensory','life','entertainment','health','learning','spiritual'].includes(parsed.category);
          if (isSubjective) {
            result.subjective.push({ category: parsed.category, subcategory: parsed.subcategory, content: parsed.content || text.substring(0, 100) });
          } else {
            const table = ['project','client','deal','decision'].includes(parsed.category) ? 'affairs' : ['person'].includes(parsed.category) ? 'network' : 'events';
            result.objective.push({ table: table as any, category: parsed.category, content: parsed.content || text.substring(0, 100) });
          }
        }
      } catch { /* LLM 失败静默降级到纯规则结果 */ }
    }

    return result;
  }

  /**
   * 审查关卡：钙质 >= 0.5 且 有实体 → 通过
   */
  review(text: string, calciumScore: number, hasEntity: boolean): boolean {
    if (!text || text.length < 3) return false;
    if (calciumScore >= 0.5 && hasEntity) return true;
    // 钙质较低但有明确的主人自称声明也通过
    if (/我/.test(text) && /[是在学的做想去有会能爱喜恨感]/.test(text) && text.length > 5) return true;
    if (/我的/.test(text) && text.length > 4) return true;
    // 中文话题式表达：描述自身状态/行为（含"了"、"在"、"觉得"、"最近"等）
    if (/在[学做画看听玩]/.test(text) || /觉得/.test(text) || /最近/.test(text)) return true;
    // 表达主观感受
    if (/很喜欢|想[学去玩]|有点[烦累忙]|太[好了累烦]|不错|有意思|喜欢/.test(text)) return true;
    return false;
  }

  /**
   * 存储：写入对应表
   */
  store(text: string, result: ExtractResult): void {
    console.log('[Mirror] storing:', JSON.stringify({subj: result.subjective.length, obj: result.objective.length}));
    if (result.subjective.length > 0) console.log('[Mirror] subj[0]:', JSON.stringify(result.subjective[0]));
    if (result.objective.length > 0) console.log('[Mirror] obj[0]:', JSON.stringify(result.objective[0]));
    const now = new Date().toISOString();

    // 主观世界 → master_profile
    for (const item of result.subjective) {
      if (!item.category) continue;
      const existing = this.sqlite.queryAll(
        'SELECT id, mention_count, confidence FROM master_profile WHERE category = ? AND content LIKE ? ORDER BY last_seen DESC LIMIT 1',
        [item.category, '%' + item.content.substring(0, 30) + '%']
      );
      if (existing.length > 0) {
        this.sqlite.writeRaw(
          'UPDATE master_profile SET mention_count = mention_count + 1, confidence = MIN(1.0, confidence + 0.05), last_seen = ? WHERE id = ?',
          now, existing[0].id
        );
      } else {
        const id = 'prof_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
        try {
          this.sqlite.writeRaw(
            'INSERT INTO master_profile (id, category, subcategory, content, source, confidence, calcium_score, mention_count, first_seen, last_seen, tags) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)',
            id, String(item.category || 'unknown'), item.subcategory || '', String(item.content), 'auto_extract', 0.5, now, now, JSON.stringify(['auto_extract'])
          );
        } catch(e) { console.warn('[Mirror] store failed:', String(item.category), String(item.content).substring(0,20), e instanceof Error ? e.message : String(e)); }
      }
    }

    // 客观世界 → master_affairs / master_network / master_events
    for (const item of result.objective) {
      if (!item.category) continue;
      if (item.table === 'affairs') {
        // 去重：相同标题+活跃状态不重复创建
        const existing = this.sqlite.queryAll(
          "SELECT id FROM master_affairs WHERE status = 'active' AND title LIKE ?",
          ['%' + item.content.substring(0, 20) + '%']
        );
        if (existing.length === 0) {
          const id = 'aff_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
          this.sqlite.writeRaw(
            'INSERT INTO master_affairs (id, category, title, status, description, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            id, String(item.category), String(item.content).substring(0, 60), 'active', String(item.content), 'auto_extract', now, now
          );
        }
      }
      if (item.table === 'network') {
        // 自动从内容中提取人名（简化匹配，3字以内中文）
        const matched = item.content.match(/[一-龥]{2,3}/);
        const foundName = matched ? matched[0] : null;
        if (foundName) {
          const existing = this.sqlite.queryAll('SELECT id FROM master_network WHERE person_name = ?', [foundName]);
          if (existing.length === 0) {
            const id = 'net_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
            this.sqlite.writeRaw(
              'INSERT INTO master_network (id, person_name, relation_type, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
              id, foundName, String(item.category), String(item.content), now, now
            );
          }
        }
      }
      if (item.table === 'events') {
        const id = 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
        this.sqlite.writeRaw(
          'INSERT INTO master_events (id, event_type, title, summary, created_at) VALUES (?, ?, ?, ?, ?)',
          id, String(item.category), String(item.content).substring(0, 60), String(item.content), now
        );
      }
    }
  }

  /**
   * 检索：获取关于主人的信息摘要（用于回复前注入）
   */
  retrieveAboutYou(limit = 6): string {
    // 主观世界：高置信度优先
    const profile = this.sqlite.queryAll(
      'SELECT category, content, confidence FROM master_profile ORDER BY confidence DESC, last_seen DESC LIMIT ?',
      [limit]
    );
    // 客观世界：活跃事务优先
    const affairs = this.sqlite.queryAll(
      "SELECT title, category FROM master_affairs WHERE status = 'active' ORDER BY priority DESC, updated_at DESC LIMIT 3"
    );
    // 最近事件
    const events = this.sqlite.queryAll(
      'SELECT title, event_type FROM master_events ORDER BY created_at DESC LIMIT 2'
    );
    // 重要人脉
    const network = this.sqlite.queryAll(
      'SELECT person_name, relation_type, organization FROM master_network WHERE importance >= 3 ORDER BY last_contact DESC LIMIT 3'
    );

    const lines: string[] = [];
    const cats: Record<string, string> = { world_view:'精神', inner_world:'内心', sensory:'感官', life:'生活', entertainment:'娱乐', health:'健康', learning:'学习', spiritual:'精神', project:'项目', client:'客户', decision:'决策', person:'人脉', achievement:'成就', milestone:'事件' };

    for (const p of profile) {
      const label = cats[p.category as string] || p.category;
      lines.push('- ' + (p.content as string).substring(0, 60) + '（' + label + '）');
    }
    for (const a of affairs) {
      lines.push('- 在做' + (a.title as string).substring(0, 40) + '（工作）');
    }
    for (const e of events) {
      const label = cats[e.event_type as string] || e.event_type;
      lines.push('- ' + (e.title as string).substring(0, 40) + '（' + label + '）');
    }
    for (const n of network) {
      const org = n.organization ? '(' + n.organization + ')' : '';
      lines.push('- ' + n.person_name + org + '（人脉）');
    }

    if (lines.length === 0) return '';
    return '【关于你】我知道的你：\n' + lines.slice(0, limit).join('\n') + '\n';
  }
}
