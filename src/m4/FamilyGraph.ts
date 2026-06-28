// FamilyGraph — SQLite 图结构家族知识库
// Ref: M4-design-v1.md §3
//
// ╔═══════════════════════════════════════════════════════╗
// ║  FamilyGraph.ts  v1.0                                 ║
// ║  归属: M4 (知识融合层)                               ║
// ║  职责: 家族关系图谱的存储与自动推断                    ║
// ║  日期: 2026-06-02                                    ║
// ╚═══════════════════════════════════════════════════════╝

// @ts-ignore - sql.js ships its own types via dist/sql-wasm.js
import initSqlJs from 'sql.js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityGene } from '../m1/types/dna.js';
import { validatePersonName, validateRelationType } from './EntityValidator.js';
import type {
  FamilyGraph as FamilyGraphInterface,
  GraphNode,
  GraphEdge,
  GraphQueryResult,
  GraphPath,
  InferenceResult,
  FamilySummary,
  RelationCandidate,
} from './types/graph.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data', 'knowledge', 'family_graph.db');

/**
 * P1: 人物画像 — 从"名字"到"完整的人"
 * 存储在 node.properties JSON 中，每次对话逐步丰富。
 *
 * v1.1 升级: 新增 PersonDossier 6 模块结构化档案体系
 *  - 基础信息卡、人生履历、形象特质、性格偏好、关系定位、记忆锚点
 *  - 原有 flat 字段保持兼容
 *  - 新增字段通过 dossier 子对象存储
 */
interface PersonProfile {
  // ── 基础 ──
  name: string;
  relation_to_user: string;
  /** 首次提及日期 */
  first_mentioned?: string;
  /** 最近提及日期 */
  last_mentioned: string;
  /** 累计提及次数 */
  mention_count: number;

  // ── 人物全方位档案（用户说的所有信息累计） ──
  /** 外貌长相：身高、脸型、五官、皮肤、发型等 */
  appearance?: string;
  /** 身体特征：身材、胸、臀、腰、腿等 */
  body_features?: string;
  /** 穿着风格 */
  style?: string;
  /** 性格特征：开朗/幽默/热心 等 */
  traits?: string[];
  /** 性格自由描述 */
  personality?: string;
  /** 职业 */
  occupation?: string;
  /** 兴趣爱好 */
  interests?: string[];
  /** 习惯 */
  habits?: string;
  /** 心理/内心特征 */
  psychology?: string;
  /** 声音特征 */
  voice?: string;
  /** 自由文本描述（累计所有说过的话） */
  description?: string;

  /** 重要事件时间线 */
  timeline?: Array<{
    date: string;
    summary: string;
    emotion?: string;
  }>;
  /** 玉瑶已问过的问题（去重用） */
  asked_questions?: string[];
  /** 画像完整度（0-1，自动计算） */
  completeness?: number;

  // ── v1.1 新增: 6 模块结构化档案 + 辅助字段 ──
  /** 结构化人事档案（6 模块） */
  dossier?: PersonDossier;
  /** 待确认条目（30 天 TTL） */
  pendingItems?: PendingItem[];
  /** 已记录的冲突历史 */
  conflicts?: Array<{ field: string; oldValue: string; newValue: string; timestamp: string }>;
  /** 是否标记为有冲突 */
  conflict?: boolean;
}

/**
 * 6 模块人事档案结构化定义
 * 所有档案字段统一走 EntityValidator 校验
 *
 * v1.2 升级: 扩展为完整人事档案体系
 * - 新增 联系方式、健康状况、人生里程碑、家庭关系网、社会资本 模块
 * - 原6模块扩展为10模块
 */
interface PersonDossier {
  /** 模块① 基础信息卡 */
  basicInfo: {
    gender?: string;
    birthYear?: number;
    birthPlace?: string;
    education?: string;
    maritalStatus?: string;
    /** 生肖 */
    zodiac?: string;
    /** 民族 */
    ethnicity?: string;
  };
  /** 模块② 联系方式 */
  contact: {
    phone?: string;
    wechat?: string;
    address?: string;
    email?: string;
    workplace?: string;
  };
  /** 模块③ 人生履历 */
  lifeResume: {
    timeline: Array<{ date: string; summary: string; emotion?: string }>;
    careerHistory?: string;
    notableEvents?: string[];
  };
  /** 模块④ 形象特质 — 含女性详细体征描述 */
  imageTraits: {
    looks?: string;        // 外貌长相（脸型、五官、皮肤等）
    bodyFeatures?: string;  // 身材特征（身高、体型、曲线等）
    style?: string;         // 穿着风格
    voice?: string;         // 声音特征
    distinguishingMarks?: string;  // 辨识特征（痣、纹身、疤痕等）
    /** 香水/气味标签 */
    scent?: string;
    /** 🧬 女性详细体征（非家人女性专用 — 详细到像活生生站在眼前） */
    feminineDetails?: {
      /** 整体印象 — 看到她的第一感觉、气质类型 */
      firstImpression?: string;
      /** 身高体型 */
      stature?: string;
      /** 三围/身材数据（胸围/腰围/臀围/腿长等描述） */
      measurements?: string;
      /** 胸部特征（大小/形状/手感/乳晕等） */
      breasts?: string;
      /** 臀部特征（大小/形状/手感/弹性） */
      buttocks?: string;
      /** 腰/腹部特征 */
      waist?: string;
      /** 腿部特征 */
      legs?: string;
      /** 皮肤（颜色/质感/光滑度/温度） */
      skin?: string;
      /** 手部特征 */
      hands?: string;
      /** 唇部特征 */
      lips?: string;
      /** 眼神/眼睛特征 */
      eyes?: string;
      /** 秀发特征 */
      hair?: string;
      /** 性感度/魅惑力描述 */
      allure?: string;
      /** 私密体味/体香 */
      bodyScent?: string;
      /** 触感描述（皮肤手感、身体温度等） */
      touch?: string;
      /** 亲密时的反应特征 */
      intimateReaction?: string;
      /** 特殊记忆点（最让人怀念的独特之处） */
      memorableTraits?: string;
    };
  };
  /** 模块⑤ 性格偏好 */
  personalityPrefs: {
    traits: string[];       // 标签化性格（开朗/幽默等）
    description?: string;   // 性格自由描述
    interests: string[];    // 兴趣爱好
    habits?: string;        // 习惯
    psychology?: string;    // 心理/内心特征
  };
  /** 模块⑥ 关系定位 — 与用户的关系定位 + 交集记录 */
  relationMap: {
    relationToUser: string; // 与用户的关系
    /** 交集与共同经历 — 用户与此人的工作、生活、情感、社交等所有互动记录 */
    intersections?: {
      /** 结识时间/场景 */
      metWhen?: string;
      /** 共事记录（怎么认识的、一起做过什么项目/业务） */
      workTogether?: string;
      /** 生活交集（一起做过的事、去过的地方、共同的社交圈） */
      lifeIntersection?: string;
      /** 情感评价（用户对此人的真实情感倾向：信任/依赖/亲密/敌视/疏远等） */
      emotionalAssessment?: string;
      /** 利益关系（合伙人/上下游/竞争/雇佣等） */
      interestRelation?: string;
      /** 重要共同事件 */
      sharedEvents?: Array<{
        date: string;
        event: string;
        type: 'work' | 'life' | 'family' | 'business';
      }>;
    };
    notes?: string;          // 自由备注
  };
  /** 模块⑦ 家庭关系网 */
  familyNetwork: {
    /** 父母 */
    parents?: string[];
    /** 配偶 */
    spouse?: string;
    /** 子女 */
    children?: string[];
    /** 兄弟姐妹 */
    siblings?: string[];
    /** 其他亲属关系描述 */
    extended?: string;
  };
  /** 模块⑧ 健康状况 */
  health: {
    /** 身体状况描述 */
    condition?: string;
    /** 病史/疾病 */
    medicalHistory?: string;
    /** 过敏信息 */
    allergies?: string;
    /** 生活习惯（烟酒茶等） */
    lifestyle?: string;
  };
  /** 模块⑨ 人生里程碑 */
  lifeMilestones: Array<{
    date: string;
    event: string;
    type: 'birth' | 'marriage' | 'childbirth' | 'death' | 'career' | 'education' | 'other';
    detail?: string;
  }>;
  /** 模块⑩ 社会资本 */
  socialCapital: {
    /** 同事/合作伙伴 */
    colleagues?: string[];
    /** 朋友 */
    friends?: string[];
    /** 客户 */
    clients?: string[];
    /** 重要社交关系描述 */
    description?: string;
  };
  /** 记忆锚点（Top-5，满5自动淘汰最旧） */
  memoryAnchors: {
    diamondIds: string[];   // 最多 5 条，存黑钻记忆 ID
  };
}

/** 待确认条目（30 天 TTL） */
interface PendingItem {
  field: string;            // 对应的模块字段名
  value: string;            // 待确认的值
  source: string;           // 来源（对话摘要）
  timestamp: string;        // 创建时间
  confirmed: boolean;       // 是否已确认
}

// ─── 亲属称谓 → 关系映射（自动推断核心词表）───
// Ref: M4-design-v1.md §3.5
const KINSHIP_MAP: Record<string, string> = {
  '妈妈': 'mother_of', '妈': 'mother_of', '母亲': 'mother_of',
  '爸爸': 'father_of', '爸': 'father_of', '父亲': 'father_of',
  '老公': 'spouse_of', '老婆': 'spouse_of',
  '丈夫': 'spouse_of', '妻子': 'spouse_of',
  '哥哥': 'sibling_of', '弟弟': 'sibling_of',
  '姐姐': 'sibling_of', '妹妹': 'sibling_of',
  '爷爷': 'grandfather_of', '奶奶': 'grandmother_of',
  '外公': 'grandfather_of', '外婆': 'grandmother_of',
  // FIX-2: 补充缺失的亲属称谓
  '儿子': 'child_of', '女儿': 'child_of', '孩子': 'child_of', '子女': 'child_of',
  '孙子': 'grandchild_of', '孙女': 'grandchild_of',
};

// ─── 社交关系 → 关系映射（与 KINSHIP_MAP 互补——同一人可同时拥有家族边和社交边）───
// Ref: STRATEGIC_BLUEPRINT.md — 人际关系图谱
const SOCIAL_MAP: Record<string, string> = {
  '同事': 'colleague_of', '同学': 'classmate_of', '室友': 'roommate_of',
  '老板': 'boss_of', '上司': 'boss_of', '领导': 'boss_of',
  '下属': 'subordinate_of', '部下': 'subordinate_of', '手下': 'subordinate_of',
  '客户': 'client_of', '顾客': 'client_of',
  '朋友': 'friend_of', '好友': 'friend_of',
  '合伙人': 'partner_of', '搭档': 'partner_of',
  '邻居': 'neighbor_of',
  '老师': 'teacher_of', '师父': 'teacher_of', '师傅': 'teacher_of',
  '学生': 'student_of', '徒弟': 'student_of',
  '医生': 'doctor_of',
  '顾问': 'consultant_of',
};

const SOCIAL_REVERSE: Record<string, string> = {
  colleague_of: 'colleague_of', classmate_of: 'classmate_of', roommate_of: 'roommate_of',
  boss_of: 'subordinate_of', subordinate_of: 'boss_of',
  client_of: 'server_of', friend_of: 'friend_of',
  partner_of: 'partner_of', neighbor_of: 'neighbor_of',
  teacher_of: 'student_of', student_of: 'teacher_of',
  doctor_of: 'patient_of', consultant_of: 'client_of',
  server_of: 'client_of', acquaintance_of: 'acquaintance_of',
};

const REVERSE_RELATION: Record<string, string> = {
  parent_of: 'child_of',
  mother_of: 'child_of', father_of: 'child_of',
  spouse_of: 'spouse_of',
  sibling_of: 'sibling_of',
  grandfather_of: 'grandchild_of', grandmother_of: 'grandchild_of',
  child_of: 'parent_of',
  grandchild_of: 'grandfather_of',
  lives_in: 'residence_of',
  close_to: 'close_to',
};

/**
 * 生成简单 UUID
 */
function uid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

/**
 * FamilyGraph — SQLite 图结构家族知识库
 *
 * 使用 sql.js（纯 JS 的 SQLite 实现）存储图数据库。
 * 节点表 (nodes) + 边表 (edges)，SQL 递归查询。
 *
 * v1.0 聚焦：自动提取 + 关系推断
 */
export class FamilyGraph implements FamilyGraphInterface {
  private db: any | null = null;
  private dbPath: string;
  private userNodeId: string | null = null;
  /** P4: 批量落盘 — 减少IO */
  private _dirty = false;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? DEFAULT_DB_PATH;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        aliases TEXT DEFAULT '[]',
        properties TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.run(`
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        properties TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES nodes(id),
        FOREIGN KEY (target_id) REFERENCES nodes(id)
      )
    `);
    this.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    this.run('CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)');
    this.run('CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)');
    this.run('CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)');
    this.run('CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation)');

    this.markDirty();
  }

  async addNode(node: GraphNode): Promise<void> {
    this.run(
      'INSERT OR IGNORE INTO nodes (id, type, name, aliases, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        node.id,
        node.type,
        node.name,
        JSON.stringify(node.aliases ?? []),
        JSON.stringify(node.properties ?? {}),
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
    this.markDirty(true);
  }

  async addEdge(edge: GraphEdge): Promise<void> {
    this.run(
      'INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        edge.id ?? uid(),
        edge.source_id,
        edge.target_id,
        edge.relation,
        JSON.stringify(edge.properties ?? {}),
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );
    this.markDirty(true);
  }

  async findRelated(entityName: string, relation?: string): Promise<GraphQueryResult[]> {
    const results: GraphQueryResult[] = [];

    // 查找节点
    let sql = 'SELECT * FROM nodes WHERE name = ?';
    if (entityName.includes('%')) {
      sql = 'SELECT * FROM nodes WHERE name LIKE ?';
    }
    const nodes = this.query(sql, [entityName]);
    if (nodes.length === 0) return results;

    for (const node of nodes) {
      const relationships: GraphQueryResult['relationships'] = [];

      // 出边
      let edgeSql = 'SELECT e.*, n.id as nid, n.type as ntype, n.name as nname FROM edges e JOIN nodes n ON e.target_id = n.id WHERE e.source_id = ?';
      const params: string[] = [node.id];
      if (relation) {
        edgeSql += ' AND e.relation = ?';
        params.push(relation);
      }
      const outgoing = this.query(edgeSql, params);
      for (const e of outgoing) {
        relationships.push({
          relation: e.relation,
          direction: 'outgoing',
          targetNode: this.rowToNode(e),
        });
      }

      // 入边
      edgeSql = 'SELECT e.*, n.id as nid, n.type as ntype, n.name as nname FROM edges e JOIN nodes n ON e.source_id = n.id WHERE e.target_id = ?';
      const inParams: string[] = [node.id];
      if (relation) {
        edgeSql += ' AND e.relation = ?';
        inParams.push(relation);
      }
      const incoming = this.query(edgeSql, inParams);
      for (const e of incoming) {
        relationships.push({
          relation: e.relation,
          direction: 'incoming',
          targetNode: this.rowToNode(e),
        });
      }

      results.push({ node: this.rowToNode(node), relationships });
    }

    return results;
  }

  async findPath(sourceName: string, targetName: string): Promise<GraphPath | null> {
    // 简单 BFS（限于深度 ≤4）
    const sourceNodes = this.query('SELECT id FROM nodes WHERE name = ?', [sourceName]);
    const targetNodes = this.query('SELECT id FROM nodes WHERE name = ?', [targetName]);
    if (sourceNodes.length === 0 || targetNodes.length === 0) return null;

    const startId = sourceNodes[0].id;
    const endId = targetNodes[0].id;

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: GraphNode[]; edgePath: GraphEdge[] }> = [
      { nodeId: startId, path: [], edgePath: [] },
    ];
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.nodeId === endId) {
        return { nodes: current.path, edges: current.edgePath };
      }
      if (current.path.length >= 4) continue;

      const neighbors = this.query(
        `SELECT e.id as eid, e.relation, e.source_id, e.target_id, n.*
         FROM edges e JOIN nodes n ON (e.target_id = n.id OR e.source_id = n.id)
         WHERE (e.source_id = ? OR e.target_id = ?) AND n.id != ?`,
        [current.nodeId, current.nodeId, current.nodeId]
      );

      for (const nb of neighbors) {
        const nextId = nb.source_id === current.nodeId ? nb.target_id : nb.source_id;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push({
            nodeId: nextId,
            path: [...current.path, this.rowToNode(nb)],
            edgePath: [
              ...current.edgePath,
              { id: nb.eid, source_id: nb.source_id, target_id: nb.target_id, relation: nb.relation },
            ],
          });
        }
      }
    }

    return null;
  }

  async integrateFromEntity(entities: EntityGene[], rawInput: string, selfName?: string): Promise<InferenceResult> {
    const details: string[] = [];
    let nodesCreated = 0;
    let edgesCreated = 0;
    const userName = selfName ?? '我';

    // 确保用户节点存在
    const userNodes = this.query('SELECT id FROM nodes WHERE name = ?', [userName]);
    let userId: string;
    if (userNodes.length === 0) {
      userId = uid();
      await this.addNode({
        id: userId,
        type: 'person',
        name: userName,
        aliases: ['我', '我自己'],
      });
      nodesCreated++;
      details.push(`创建用户节点: ${userName}`);
    } else {
      userId = userNodes[0].id;
    }
    this.userNodeId = userId;

    // 扫描 entity_genes，检测亲属称谓 + 人名的组合
    const persons = entities.filter((e) => e.type === 'person');
    const places = entities.filter((e) => e.type === 'place');

    // 🔴 长辈称谓列表（说话者是晚辈，关系方向需反转）
    const SENIOR_KINSHIP = new Set(['妈妈','妈','母亲','爸爸','爸','父亲','爷爷','奶奶','外公','外婆','祖父','祖母']);

    for (const person of persons) {
      // 检查该人名是否在 kinship 词表中
      const kinshipWord = Object.keys(KINSHIP_MAP).find((kw) => rawInput.includes(kw));
      if (kinshipWord) {
        const relation = KINSHIP_MAP[kinshipWord];
        const isSenior = SENIOR_KINSHIP.has(kinshipWord);

        // 创建或查找该人名的节点
        const existing = this.query('SELECT id FROM nodes WHERE name = ?', [person.name]);
        let personId: string;
        if (existing.length === 0) {
          personId = uid();
          await this.addNode({
            id: personId,
            type: 'person',
            name: person.name,
          });
          nodesCreated++;
          details.push(`创建节点: ${person.name} (${kinshipWord})`);
          // P1: 自动创建人物画像
          await this.updatePersonProfile(person.name, { relation_to_user: this.describeRelation(relation) } as any);
        } else {
          personId = existing[0].id;
        }

        // 长辈称谓反转方向：用户说"我妈妈"→ 妈妈--[mother_of]-->我 + 我--[child_of]-->妈妈
        // 而非 我--[mother_of]-->妈妈（那意味着我是妈妈的妈）
        const sourceId = isSenior ? personId : userId;
        const targetId = isSenior ? userId : personId;

        // 检查是否已有此边（防止重复）
        const existingEdge = this.query(
          'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
          [sourceId, targetId, relation]
        );
        if (existingEdge.length === 0) {
          await this.addEdge({
            id: uid(),
            source_id: sourceId,
            target_id: targetId,
            relation,
          });
          edgesCreated++;
          const fromName = isSenior ? person.name : userName;
          const toName = isSenior ? userName : person.name;
          details.push(`创建边: ${fromName} --${relation}--> ${toName}`);

          // 自动创建反向边
          const reverseRel = REVERSE_RELATION[relation];
          if (reverseRel && reverseRel !== relation) {
            const revSrc = isSenior ? userId : personId;
            const revTgt = isSenior ? personId : userId;
            const revEdge = this.query(
              'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
              [revSrc, revTgt, reverseRel]);
            if (revEdge.length === 0) {
              await this.addEdge({
                id: uid(),
                source_id: revSrc,
                target_id: revTgt,
                relation: reverseRel,
              });
              edgesCreated++;
              const revFrom = isSenior ? userName : person.name;
              const revTo = isSenior ? person.name : userName;
              details.push(`创建反向边: ${revFrom} --${reverseRel}--> ${revTo}`);
            }
          }
        } else {
          const existFrom = isSenior ? person.name : userName;
          const existTo = isSenior ? userName : person.name;
          details.push(`边已存在: ${existFrom} --${relation}--> ${existTo}`);
        }
      } else {
        // 非亲属人名 → 社交关系记录（所有人名都入库，不丢弃）
        const _ex = this.query('SELECT id FROM nodes WHERE name = ?', [person.name]);
        let _pid: string;
        if (_ex.length === 0) {
          _pid = uid();
          await this.addNode({ id: _pid, type: 'person', name: person.name });
          nodesCreated++;
          details.push('创建社交节点: ' + person.name);
          await this.updatePersonProfile(person.name, {} as any);
        } else {
          _pid = _ex[0].id;
        }
        const _ee = this.query('SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?', [userId, _pid, 'acquaintance_of']);
        if (_ee.length === 0) {
          await this.addEdge({ id: uid(), source_id: userId, target_id: _pid, relation: 'acquaintance_of' });
          edgesCreated++;
          details.push('创建社交边: ' + userName + ' --acquaintance_of--> ' + person.name);
        }
      }
    }

    // 地点关联：如果提到家庭成员 + 地点 → 自动创建 lives_in
    if (persons.length > 0 && places.length > 0) {
      for (const place of places) {
        const pNodes = this.query('SELECT id FROM nodes WHERE name = ?', [place.name]);
        let placeId: string;
        if (pNodes.length === 0) {
          placeId = uid();
          await this.addNode({
            id: placeId,
            type: 'place',
            name: place.name,
          });
          nodesCreated++;
          details.push(`创建地点节点: ${place.name}`);
        } else {
          placeId = pNodes[0].id;
        }

        // 为用户和所有亲属创建 lives_in 边
        const allNodes = [userId, ...persons.map((p) => {
          const found = this.query('SELECT id FROM nodes WHERE name = ?', [p.name]);
          return found.length > 0 ? found[0].id : null;
        }).filter(Boolean)];

        for (const nid of allNodes) {
          if (!nid) continue;
          const exists = this.query(
            'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
            [nid, placeId, 'lives_in']
          );
          if (exists.length === 0) {
            await this.addEdge({ id: uid(), source_id: nid, target_id: placeId, relation: 'lives_in' });
            edgesCreated++;
            details.push(`创建边: lives_in --> ${place.name}`);
          }
        }
      }
    }

    return { nodes_created: nodesCreated, edges_created: edgesCreated, details };
  }

  async correctRelation(source: string, target: string, correctRelation: string): Promise<void> {
    // 查找旧边并删除
    const srcNodes = this.query('SELECT id FROM nodes WHERE name = ?', [source]);
    const tgtNodes = this.query('SELECT id FROM nodes WHERE name = ?', [target]);
    if (srcNodes.length === 0 || tgtNodes.length === 0) return;

    this.run('DELETE FROM edges WHERE source_id = ? AND target_id = ?', [srcNodes[0].id, tgtNodes[0].id]);
    this.run('DELETE FROM edges WHERE source_id = ? AND target_id = ?', [tgtNodes[0].id, srcNodes[0].id]);

    // 创建正确边
    await this.addEdge({
      id: uid(),
      source_id: srcNodes[0].id,
      target_id: tgtNodes[0].id,
      relation: correctRelation,
    });

    const reverse = REVERSE_RELATION[correctRelation];
    if (reverse && reverse !== correctRelation) {
      await this.addEdge({
        id: uid(),
        source_id: tgtNodes[0].id,
        target_id: srcNodes[0].id,
        relation: reverse,
      });
    }

    this.markDirty();
  }

  async addFamilyMember(name: string, relation: string, aliases?: string[]): Promise<void> {
    const selfName = this.userNodeId ?? '我';
    const uNodes = this.query('SELECT id FROM nodes WHERE name = ?', [selfName]);
    let userNodeId: string;
    if (uNodes.length === 0) {
      userNodeId = uid();
      await this.addNode({ id: userNodeId, type: 'person', name: selfName });
    } else {
      userNodeId = uNodes[0].id;
    }

    const pNodes = this.query('SELECT id FROM nodes WHERE name = ?', [name]);
    let personId: string;
    if (pNodes.length === 0) {
      personId = uid();
      await this.addNode({
        id: personId,
        type: 'person',
        name,
        aliases,
      });
    } else {
      personId = pNodes[0].id;
    }

    await this.addEdge({ id: uid(), source_id: userNodeId, target_id: personId, relation });
    const reverse = REVERSE_RELATION[relation];
    if (reverse && reverse !== relation) {
      await this.addEdge({ id: uid(), source_id: personId, target_id: userNodeId, relation: reverse });
    }
  }

  /**
   * 整合社交关系到图谱（与 integrateFromEntity 互补——它处理家族关系，这个处理社交关系）
   *
   * 当 chat.ts 中的 RelationshipExtractor 检测到非家庭人士时调用此方法。
   * 同一人可同时拥有家族边（妈妈）和社交边（同事）——两边不冲突。
   * 家族主线和社交副线彼此独立，但在同一张图中可交叉引用。
   */
  async integrateSocialRelation(personName: string, relationType: string, rawInput: string): Promise<InferenceResult> {
    const details: string[] = [];
    let nodesCreated = 0;
    let edgesCreated = 0;

    // 🔴 非人名过滤：2字名第二字不是姓氏的拒绝入库（"应该""时候""强度"等）
    const SURNAMES = new Set('赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公');
    const COMMON_WORDS = new Set(['应该','时候','强度','索引','关联','相遇','相似','职责','储所','全长','公了','公桌','和种','史摘','和事','那那','白衬','鲁呢','段美','衣块','单员','明天','谢你','谢了','包子','公司']);
    if (personName.length === 2) {
      if (COMMON_WORDS.has(personName)) {
        details.push(`过滤非人名: ${personName}`);
        return { nodes_created: 0, edges_created: 0, details };
      }
    }
    if (personName === '有人' || personName === '某人' || personName === '大家') {
      return { nodes_created: 0, edges_created: 0, details };
    }

    // 查找或创建"我"节点
    const userNodes = this.query('SELECT id FROM nodes WHERE name = ?', ['我']);
    let userId: string;
    if (userNodes.length === 0) {
      userId = uid();
      await this.addNode({ id: userId, type: 'person', name: '我', aliases: ['我', '我自己'] });
      nodesCreated++;
    } else {
      userId = userNodes[0].id;
    }
    this.userNodeId = userId;

    // 查找或创建该人的节点
    const existing = this.query('SELECT id FROM nodes WHERE name = ?', [personName]);
    let personId: string;
    if (existing.length === 0) {
      personId = uid();
      await this.addNode({ id: personId, type: 'person', name: personName });
      nodesCreated++;
      details.push(`创建社交节点: ${personName}`);
      // P1: 自动创建人物画像
      await this.updatePersonProfile(personName, {} as any);
    } else {
      personId = existing[0].id;
    }

    // 🔴 家族边拦截：如果此人已有家族关系边，跳过社交边（防止"老公"同时有 spouse_of 和 acquaintance_of）
    if (relationType === 'acquaintance_of') {
      const familyRelTypes = new Set(['mother_of','father_of','spouse_of','sibling_of','child_of','grandfather_of','grandmother_of','parent_of','grandchild_of']);
      const hasFamily = this.query(
        'SELECT id FROM edges WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)',
        [userId, personId, personId, userId]
      ).some((e: any) => familyRelTypes.has(e.relation));
      if (hasFamily) {
        details.push(`跳过社交边（已有家族关系）: ${personName}`);
        return { nodes_created: 0, edges_created: 0, details };
      }
    }

    // 检查是否已有此边（防止重复）
    const existingEdge = this.query(
      'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      [userId, personId, relationType]
    );
    if (existingEdge.length === 0) {
      await this.addEdge({ id: uid(), source_id: userId, target_id: personId, relation: relationType });
      edgesCreated++;
      details.push(`创建社交边: 我 --${relationType}--> ${personName}`);

      // 自动创建反向边
      const reverseRel = SOCIAL_REVERSE[relationType] || 'acquaintance_of';
      if (reverseRel && reverseRel !== relationType) {
        const revEdge = this.query(
          'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
          [personId, userId, reverseRel]
        );
        if (revEdge.length === 0) {
          await this.addEdge({ id: uid(), source_id: personId, target_id: userId, relation: reverseRel });
          edgesCreated++;
          details.push(`创建反向社交边: ${personName} --${reverseRel}--> 我`);
        }
      }
    } else {
      details.push(`社交边已存在: 我 --${relationType}--> ${personName}`);
    }

    return { nodes_created: nodesCreated, edges_created: edgesCreated, details };
  }

  /**
   * 🔄 社交→家族升级：当一个人已存在于社交图谱（acquaintance_of 等社交边），
   * 但当前对话检测到家庭关系（如"熊勇是我表弟"→ 表弟=兄弟）时，
   * 添加家族边而不删除社交边（同一人可兼具双重身份——既是同事又是亲戚）。
   *
   * @param personName 人名
   * @param familyRelation 家族关系值（如 '兄弟', '配偶', '子女'）
   * @param context 上下文备注
   */
  async promoteSocialToFamily(personName: string, familyRelation: string, context?: string): Promise<void> {
    const KINSHIP_MAP_INTERNAL: Record<string, string> = {
      '配偶': 'spouse_of', '恋人': 'spouse_of',
      '父亲': 'father_of', '母亲': 'mother_of', '儿子': 'child_of', '女儿': 'child_of', '子女': 'child_of',
      '兄弟': 'sibling_of', '姐妹': 'sibling_of',
      '祖父': 'grandfather_of', '祖母': 'grandmother_of',
      '公婆': 'parent_of', '岳父母': 'parent_of',
    };
    const relation = KINSHIP_MAP_INTERNAL[familyRelation];
    if (!relation) return; // 不认识的关系类型，跳过

    // 获取"我"节点
    const meNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', ['我', 'person']);
    if (meNodes.length === 0) return;
    const meId = meNodes[0].id;

    // 查找此人节点
    const personNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (personNodes.length === 0) {
      // 人不存在于图谱中 — 创建节点和家族边
      const pid = uid();
      await this.addNode({ id: pid, type: 'person', name: personName });
      await this.addEdge({ id: uid(), source_id: meId, target_id: pid, relation });
      const reverseRel = REVERSE_RELATION[relation];
      if (reverseRel && reverseRel !== relation) {
        await this.addEdge({ id: uid(), source_id: pid, target_id: meId, relation: reverseRel });
      }
      console.log(`[FamilyPromote] 新建家族节点: ${personName} (${relation})`);
      return;
    }

    const personId = personNodes[0].id;

    // 检查是否已有此家族边
    const existingFamilyEdge = this.query(
      'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      [meId, personId, relation]
    );
    if (existingFamilyEdge.length > 0) return; // 已有，无需升级

    // 检查是否已有类似的家族边（任意家族关系类型）
    const familyRelTypes = new Set(['mother_of', 'father_of', 'spouse_of', 'sibling_of', 'child_of', 'grandfather_of', 'grandmother_of', 'parent_of', 'grandchild_of']);
    const anyFamily = this.query(
      'SELECT id, relation FROM edges WHERE source_id = ? AND target_id = ?',
      [meId, personId]
    );
    const hasFamily = anyFamily.some((e: any) => familyRelTypes.has(e.relation));
    if (hasFamily) return; // 已有家族关系，无需重复

    // 添加家族边（保留社交边）
    await this.addEdge({ id: uid(), source_id: meId, target_id: personId, relation });
    const reverseRel = REVERSE_RELATION[relation];
    if (reverseRel && reverseRel !== relation) {
      await this.addEdge({ id: uid(), source_id: personId, target_id: meId, relation: reverseRel });
    }
    console.log(`[FamilyPromote] 升级: ${personName} 社交→家族 (${relation})`);
  }

  /**
   * 🔗 FIX-4: 添加两个第三方人物之间的直接关系边（非"我"相关的 person→person 边）
   * 例如: 熊梓铭 -child_of-> 熊勇, 王全芬 -spouse_of-> 熊勇
   *
   * @param srcName 源人物名
   * @param relation 关系类型（child_of / spouse_of / sibling_of 等）
   * @param tgtName 目标人物名
   * @param context 上下文（可选，存到节点 properties）
   */
  async addPersonRelation(srcName: string, relation: string, tgtName: string, context?: string): Promise<void> {
    // 查找或创建源节点
    const srcNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [srcName, 'person']);
    let srcId: string;
    if (srcNodes.length === 0) {
      srcId = uid();
      await this.addNode({ id: srcId, type: 'person', name: srcName });
      await this.updatePersonProfile(srcName, {} as any);
      console.log(`[PersonRelation] 创建节点: ${srcName}`);
    } else {
      srcId = srcNodes[0].id;
    }

    // 查找或创建目标节点
    const tgtNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [tgtName, 'person']);
    let tgtId: string;
    if (tgtNodes.length === 0) {
      tgtId = uid();
      await this.addNode({ id: tgtId, type: 'person', name: tgtName });
      await this.updatePersonProfile(tgtName, {} as any);
      console.log(`[PersonRelation] 创建节点: ${tgtName}`);
    } else {
      tgtId = tgtNodes[0].id;
    }

    // 检查正向边是否已存在
    const existingEdge = this.query(
      'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      [srcId, tgtId, relation]
    );
    if (existingEdge.length > 0) {
      console.log(`[PersonRelation] 边已存在: ${srcName} --${relation}--> ${tgtName}`);
      return;
    }

    // 创建正向边
    await this.addEdge({ id: uid(), source_id: srcId, target_id: tgtId, relation });
    console.log(`[PersonRelation] 创建边: ${srcName} --${relation}--> ${tgtName}`);

    // 自动创建反向边
    const reverseRel = REVERSE_RELATION[relation];
    if (reverseRel && reverseRel !== relation) {
      const revEdge = this.query(
        'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
        [tgtId, srcId, reverseRel]
      );
      if (revEdge.length === 0) {
        await this.addEdge({ id: uid(), source_id: tgtId, target_id: srcId, relation: reverseRel });
        console.log(`[PersonRelation] 创建反向边: ${tgtName} --${reverseRel}--> ${srcName}`);
      }
    }

    // 更新人物画像中的 relation_to_user
    switch (relation) {
      case 'child_of':
        await this.updatePersonProfile(srcName, { relation_to_user: `${tgtName}的孩子` } as any);
        await this.updatePersonProfile(tgtName, { relation_to_user: `${srcName}的家长` } as any);
        break;
      case 'parent_of':
        await this.updatePersonProfile(srcName, { relation_to_user: `${tgtName}的家长` } as any);
        await this.updatePersonProfile(tgtName, { relation_to_user: `${srcName}的孩子` } as any);
        break;
      case 'spouse_of':
        await this.updatePersonProfile(srcName, { relation_to_user: `${tgtName}的配偶` } as any);
        await this.updatePersonProfile(tgtName, { relation_to_user: `${srcName}的配偶` } as any);
        break;
      case 'sibling_of':
        await this.updatePersonProfile(srcName, { relation_to_user: `${tgtName}的兄弟姐妹` } as any);
        await this.updatePersonProfile(tgtName, { relation_to_user: `${srcName}的兄弟姐妹` } as any);
        break;
    }
  }

  /**
   * 获取社交关系摘要（与 getFamilySummary 互补，只返回非家庭关系）
   * 同一人若同时有家族边和社交边，在两个摘要中都会出现。
   */
  /** 更新人物节点的备注信息（从知识库合并时调用） */
  async updateNodeProperties(personName: string, props: Record<string, any>): Promise<void> {
    const nodes = this.query('SELECT id, properties FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (nodes.length === 0) return;
    const existingProps = JSON.parse(nodes[0].properties ?? '{}');
    const merged = { ...existingProps, ...props };
    this.run('UPDATE nodes SET properties = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(merged), new Date().toISOString(), nodes[0].id]);
    this.markDirty();
  }

  async getSocialSummary(): Promise<{ connections: Array<{ name: string; relation_to_user: string; note?: string }> }> {
    const connections: Array<{ name: string; relation_to_user: string; note?: string }> = [];
    const meNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', ['我', 'person']);
    if (meNodes.length === 0) return { connections };
    const meId = meNodes[0].id;

    const nodes = this.query('SELECT * FROM nodes');
    const socialTypes = new Set([...Object.values(SOCIAL_MAP), 'acquaintance_of']);

    for (const node of nodes) {
      if (node.type === 'person' && node.name !== '我') {
        const edges = this.query(
          `SELECT e.relation FROM edges e WHERE (e.source_id = ? AND e.target_id = ?) OR (e.source_id = ? AND e.target_id = ?)`,
          [node.id, meId, meId, node.id]
        );
        for (const edge of edges) {
          if (socialTypes.has(edge.relation)) {
            const props = node.properties ? JSON.parse(node.properties) : {};
            connections.push({
              name: node.name,
              relation_to_user: this.describeSocialRelation(edge.relation),
              note: props.备注 || props.context || undefined,
            });
            break;
          }
        }
      }
    }
    return { connections };
  }

  async getFamilySummary(): Promise<FamilySummary> {
    const members: FamilySummary['members'] = [];
    const locations = new Set<string>();

    // 实时查询"我"节点，不依赖缓存的 userNodeId
    const meNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', ['我', 'person']);
    if (meNodes.length === 0) return { members: [], locations: [] };
    const meId = meNodes[0].id;

    // 家族关系类型（不包括 acquaintance_of 等社交关系）
    const familyRels = new Set(['mother_of','father_of','spouse_of','sibling_of','grandfather_of','grandmother_of','child_of','grandchild_of','parent_of']);

    const nodes = this.query('SELECT * FROM nodes');
    for (const node of nodes) {
      if (node.type === 'person' && node.name !== '我') {
        // 查找该人与"我"的关系
        const edges = this.query(
          `SELECT e.relation FROM edges e WHERE (e.source_id = ? AND e.target_id = ?) OR (e.source_id = ? AND e.target_id = ?)`,
          [node.id, meId, meId, node.id]
        );
        // 只保留有家族关系边的人（排除纯社交联系人）
        const familyEdge = edges.find(e => familyRels.has(e.relation));
        if (!familyEdge) continue;
        members.push({
          name: node.name,
          relation_to_user: this.describeRelation(familyEdge.relation),
          aliases: JSON.parse(node.aliases ?? '[]'),
        });
      }
      if (node.type === 'place') {
        locations.add(node.name);
      }
    }

    return { members, locations: [...locations] };
  }

  // ─── 辅助方法 ───

  /** 社交关系 → 中文描述 */
  private describeSocialRelation(rel: string): string {
    const map: Record<string, string> = {
      colleague_of: '同事', classmate_of: '同学', roommate_of: '室友',
      boss_of: '老板/上级', subordinate_of: '下属/部下',
      client_of: '客户', friend_of: '朋友', partner_of: '合伙人',
      neighbor_of: '邻居', teacher_of: '老师', student_of: '学生',
      doctor_of: '医生', consultant_of: '顾问',
      server_of: '服务方', acquaintance_of: '认识的人',
    };
    return map[rel] ?? rel;
  }

  private describeRelation(rel: string): string {
    const map: Record<string, string> = {
      mother_of: '母亲', father_of: '父亲',
      spouse_of: '配偶', sibling_of: '兄弟姐妹',
      child_of: '子女', grandfather_of: '爷爷', grandmother_of: '奶奶',
      grandchild_of: '孙辈', parent_of: '父母',
      lives_in: '居住在', close_to: '亲密',
    };
    return map[rel] ?? rel;
  }

  private run(sql: string, params?: unknown[]): void {
    if (!this.db) throw new Error('FamilyGraph not initialized. Call initialize() first.');
    this.db.run(sql, params);
  }

  private query(sql: string, params?: unknown[]): any[] {
    if (!this.db) throw new Error('FamilyGraph not initialized. Call initialize() first.');
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /** 标记脏数据（500ms聚合落盘，平衡IO与可靠性） */
  private markDirty(immediate = false): void {
    this._dirty = true;
    if (immediate) { this.flush(); return; }
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => this.flush(), 500);
    }
  }

  /** P4: 强制立即落盘 */
  private flush(): void {
    if (!this._dirty || !this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
      this._dirty = false;
    } catch (err) {
      console.error('[FamilyGraph] 落盘失败:', err);
    }
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
  }

  /** P4: 显式触发落盘（关闭前调用） */
  async flushAll(): Promise<void> {
    this.flush();
  }

  // ── P1: 人物画像 ──

  /**
   * 获取人物画像
   */
  getPersonProfile(personName: string): PersonProfile | null {
    const nodes = this.query('SELECT id, properties, aliases FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (nodes.length === 0) return null;
    const node = nodes[0];
    const props: Partial<PersonProfile> = node.properties ? JSON.parse(node.properties) : {};
    return {
      name: personName,
      relation_to_user: '',
      last_mentioned: '',
      mention_count: 0,
      ...props,
    } as PersonProfile;
  }

  /**
   * SP2-3: 反义词冲突检测对
   * v1.1: 扩充覆盖外貌/性格/职业/关系四大类
   */
  private static CONFLICT_PAIRS: Array<[RegExp, RegExp]> = [
    // 外貌类
    [/高(?!中)/, /矮/], [/瘦/, /胖/], [/长发/, /短发/], [/大胸|丰满/, /平胸|飞机场|贫乳/],
    [/白/, /黑/], [/大眼睛/, /小眼睛/], [/瓜子脸|圆脸/, /方脸|长脸/], [/双眼皮/, /单眼皮/],
    [/长发/, /短发/], [/卷发/, /直发/], [/戴眼镜/, /不戴眼镜/],
    // 性格类（v1.1 新增）
    [/外向|开朗|活泼/, /内向|安静|腼腆/], [/急脾气|暴躁/, /温和|慢性子|温柔/],
    [/大方/, /小气|抠门/], [/勤快|勤奋|勤劳/, /懒|懒惰|懒散/],
    [/乐观/, /悲观|消极/], [/细心|细致/, /粗心|马虎|大大咧咧/],
    // 职业类（v1.1 新增）
    [/创业|老板|ceo|创始人|总经理/, /员工|打工|上班族|基层/],
    [/全职/, /兼职|临时/],
    // 关系类（v1.1 新增）
    [/已婚|有家室/, /未婚|单身/], [/有孩子|有小孩/, /没孩子|丁克/],
    [/本地人/, /外地人/],
  ];

  /**
   * 更新或创建人物画像
   *
   * SP2-3: 新增冲突检测 — 检测到关键字段矛盾时保留双版本+标记冲突
   * v1.1: 支持 dossier 6 模块结构化更新 + pending 待确认机制
   */
  async updatePersonProfile(personName: string, updates: Partial<PersonProfile>): Promise<void> {
    const nodes = this.query('SELECT id, properties, aliases FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (nodes.length === 0) return;

    const existing: Partial<PersonProfile> = nodes[0].properties ? JSON.parse(nodes[0].properties) : {};
    const merged: PersonProfile = {
      name: personName,
      relation_to_user: existing.relation_to_user || '',
      last_mentioned: new Date().toISOString(),
      mention_count: (existing.mention_count || 0) + 1,
      ...existing,
      ...updates,
    };
    merged.mention_count = (existing.mention_count || 0) + 1;

    // SP2-3: 冲突检测 — 检查关键描述字段矛盾
    const _conflictFields = ['appearance', 'body_features', 'description', 'occupation'];
    const _existingConflicts: Array<{ field: string; oldValue: string; newValue: string; timestamp: string }> = (existing as any).conflicts || [];
    for (const field of _conflictFields) {
      const oldVal = (existing as any)[field] || '';
      const newVal = (updates as any)[field] || '';
      if (oldVal && newVal && oldVal !== newVal) {
        const hasConflict = FamilyGraph.CONFLICT_PAIRS.some(([a, b]) => a.test(oldVal) && b.test(newVal));
        if (hasConflict) {
          _existingConflicts.push({ field, oldValue: oldVal, newValue: newVal, timestamp: new Date().toISOString() });
          (merged as any)[field] = oldVal;
          (merged as any).conflicts = _existingConflicts;
          (merged as any).conflict = true;
          console.log('[FamilyGraph] 冲突检测: ' + personName + ' ' + field + ' (' + oldVal + ' vs ' + newVal + ')');
        }
      }
    }

    // ── dossier 升级: 存量 flat 字段同步到 dossier ──
    if (!merged.dossier) {
      merged.dossier = this.buildDossierFromFlat(merged, existing as any);
    }
    // 如有新的 flat 字段更新，同步到 dossier
    if (updates.appearance && merged.dossier.imageTraits) {
      merged.dossier.imageTraits.looks = merged.dossier.imageTraits.looks || updates.appearance;
    }
    if (updates.body_features && merged.dossier.imageTraits) {
      merged.dossier.imageTraits.bodyFeatures = merged.dossier.imageTraits.bodyFeatures || updates.body_features;
    }
    if (updates.style && merged.dossier.imageTraits) {
      merged.dossier.imageTraits.style = merged.dossier.imageTraits.style || updates.style;
    }
    if (updates.voice && merged.dossier.imageTraits) {
      merged.dossier.imageTraits.voice = merged.dossier.imageTraits.voice || updates.voice;
    }
    if (updates.traits && merged.dossier.personalityPrefs) {
      for (const t of updates.traits) {
        if (!merged.dossier.personalityPrefs.traits.includes(t)) {
          merged.dossier.personalityPrefs.traits.push(t);
        }
      }
    }
    if (updates.interests && merged.dossier.personalityPrefs) {
      for (const t of updates.interests) {
        if (!merged.dossier.personalityPrefs.interests.includes(t)) {
          merged.dossier.personalityPrefs.interests.push(t);
        }
      }
    }
    if (updates.occupation && merged.dossier.basicInfo) {
      merged.dossier.basicInfo.education = merged.dossier.basicInfo.education || updates.occupation;
    }
    if (updates.relation_to_user && merged.dossier.relationMap) {
      merged.dossier.relationMap.relationToUser = updates.relation_to_user;
    }

    merged.completeness = this.calcProfileCompleteness(merged);
    this.run('UPDATE nodes SET properties = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(merged), new Date().toISOString(), nodes[0].id]);
    this.markDirty(true);
  }

  /**
   * 计算画像完整度 (0-1)
   * 权重：relation=30%, traits=20%, occupation=15%, interests=10%, timeline=15%, description=10%
   * v1.1: 支持 dossier 结构补充评分
   */
  calcProfileCompleteness(profile: PersonProfile): number {
    let score = 0;
    // flat 字段评分
    if (profile.relation_to_user && profile.relation_to_user !== '认识的人') score += 0.2;
    else if (profile.relation_to_user) score += 0.08;
    if (profile.traits && profile.traits.length > 0) score += 0.1;
    if (profile.occupation) score += 0.08;
    if (profile.interests && profile.interests.length > 0) score += 0.08;
    if (profile.timeline && profile.timeline.length > 0) score += 0.08;
    if (profile.description || profile.personality) score += 0.04;
    if (profile.appearance) score += 0.05;
    if (profile.body_features) score += 0.03;
    // dossier 10模块补充评分
    if (profile.dossier) {
      const d = profile.dossier;
      if (d.basicInfo?.gender) score += 0.03;
      if (d.basicInfo?.birthYear) score += 0.03;
      if (d.basicInfo?.birthPlace) score += 0.02;
      if (d.imageTraits?.looks) score += 0.04;
      if (d.imageTraits?.voice) score += 0.02;
      if (d.imageTraits?.distinguishingMarks) score += 0.02;
      if (d.imageTraits?.scent) score += 0.02;
      // 女性详细体征评分
      if (d.imageTraits?.feminineDetails?.firstImpression) score += 0.02;
      if (d.imageTraits?.feminineDetails?.stature || d.imageTraits?.feminineDetails?.measurements) score += 0.03;
      if (d.imageTraits?.feminineDetails?.breasts) score += 0.03;
      if (d.imageTraits?.feminineDetails?.skin) score += 0.02;
      if (d.imageTraits?.feminineDetails?.allure) score += 0.02;
      if (d.imageTraits?.feminineDetails?.bodyScent) score += 0.02;
      if (d.imageTraits?.feminineDetails?.intimateReaction || d.imageTraits?.feminineDetails?.memorableTraits) score += 0.03;
      if (d.personalityPrefs?.habits) score += 0.03;
      if (d.imageTraits?.scent) score += 0.02;
      // 交集模块评分
      if (d.relationMap?.intersections?.metWhen) score += 0.03;
      if (d.relationMap?.intersections?.workTogether) score += 0.04;
      if (d.relationMap?.intersections?.lifeIntersection) score += 0.03;
      if (d.relationMap?.intersections?.emotionalAssessment) score += 0.03;
      if (d.relationMap?.intersections?.interestRelation) score += 0.03;
      if ((d.relationMap?.intersections?.sharedEvents || []).length > 0) score += 0.04;
      if (d.personalityPrefs?.psychology) score += 0.03;
      if (d.contact?.phone || d.contact?.wechat || d.contact?.address) score += 0.03;
      if (d.familyNetwork?.parents?.length || d.familyNetwork?.spouse || d.familyNetwork?.children?.length) score += 0.05;
      if (d.health?.condition || d.health?.medicalHistory) score += 0.03;
      if (d.lifeMilestones && d.lifeMilestones.length > 0) score += 0.05;
      if (d.memoryAnchors?.diamondIds?.length > 0) score += 0.04;
    }
    return Math.round(Math.min(1, score) * 100) / 100;
  }

  /**
   * 从 flat 字段构建初始 dossier（存量迁移用）
   */
  private buildDossierFromFlat(profile: Partial<PersonProfile>, _existing: any): PersonDossier {
    return {
      basicInfo: {
        gender: undefined, birthYear: undefined, birthPlace: undefined,
        education: profile.occupation || undefined, maritalStatus: undefined,
        zodiac: undefined, ethnicity: undefined,
      },
      contact: {
        phone: undefined, wechat: undefined, address: undefined, email: undefined, workplace: undefined,
      },
      lifeResume: {
        timeline: (profile as any).timeline || [],
        careerHistory: profile.occupation || undefined,
        notableEvents: undefined,
      },
      imageTraits: {
        looks: profile.appearance || undefined,
        bodyFeatures: profile.body_features || undefined,
        style: profile.style || undefined,
        voice: profile.voice || undefined,
        distinguishingMarks: undefined,
        scent: undefined,
        feminineDetails: undefined,
      },
      personalityPrefs: {
        traits: profile.traits || [],
        description: profile.personality || undefined,
        interests: profile.interests || [],
        habits: profile.habits || undefined,
        psychology: profile.psychology || undefined,
      },
      relationMap: {
        relationToUser: profile.relation_to_user || '',
        intersections: undefined,
        notes: _existing.备注 || _existing.note || _existing.context || undefined,
      },
      familyNetwork: {
        parents: undefined, spouse: undefined, children: undefined,
        siblings: undefined, extended: undefined,
      },
      health: {
        condition: undefined, medicalHistory: undefined, allergies: undefined, lifestyle: undefined,
      },
      lifeMilestones: [],
      socialCapital: {
        colleagues: undefined, friends: undefined, clients: undefined, description: undefined,
      },
      memoryAnchors: { diamondIds: [] },
    };
  }

  /**
   * v1.1: 添加记忆锚点（Top-5，满5自动淘汰最旧）
   */
  async addMemoryAnchor(personName: string, diamondId: string): Promise<void> {
    const nodes = this.query('SELECT id, properties FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (nodes.length === 0) return;

    const props = nodes[0].properties ? JSON.parse(nodes[0].properties) : {};
    const dossier: PersonDossier = props.dossier || this.buildDossierFromFlat(props, props);
    const anchors = dossier.memoryAnchors || { diamondIds: [] };

    if (anchors.diamondIds.includes(diamondId)) return;
    anchors.diamondIds.push(diamondId);
    if (anchors.diamondIds.length > 5) {
      anchors.diamondIds = anchors.diamondIds.slice(-5);
    }
    dossier.memoryAnchors = anchors;
    props.dossier = dossier;
    this.run('UPDATE nodes SET properties = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(props), new Date().toISOString(), nodes[0].id]);
    this.markDirty(true);
  }

  /**
   * v1.1: 获取完整结构化档案
   */
  getFullProfile(personName: string): PersonDossier | null {
    const profile = this.getPersonProfile(personName);
    if (!profile) return null;
    return profile.dossier ?? this.buildDossierFromFlat(profile, {});
  }

  /**
   * v1.1: 迁移所有存量人物画像到 dossier 结构（幂等）
   */
  async migrateProfilesToDossier(): Promise<{ total: number; migrated: number; errors: number }> {
    const persons = this.query('SELECT id, name, properties FROM nodes WHERE type = ?', ['person']);
    let migrated = 0, errors = 0;
    for (const node of persons) {
      try {
        const props = node.properties ? JSON.parse(node.properties) : {};
        if (props.dossier) continue;
        const profile: Partial<PersonProfile> = { ...props, name: node.name };
        props.dossier = this.buildDossierFromFlat(profile, props);
        props.completeness = this.calcProfileCompleteness({ ...profile, dossier: props.dossier } as PersonProfile);
        this.run('UPDATE nodes SET properties = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(props), new Date().toISOString(), node.id]);
        migrated++;
      } catch { errors++; }
    }
    if (migrated > 0) {
      this.markDirty(true);
      console.log(`[FamilyGraph] dossier 迁移: ${migrated} 人升级, ${errors} 错误`);
    }
    return { total: persons.length, migrated, errors };
  }

  /**
   * v1.1: 添加待确认条目（30 天 TTL）
   */
  async addPendingItem(personName: string, field: string, value: string, source: string): Promise<void> {
    const props = this.query('SELECT properties FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (props.length === 0) return;
    const parsed = props[0].properties ? JSON.parse(props[0].properties) : {};
    const pending: PendingItem = {
      field, value, source: source.substring(0, 80),
      timestamp: new Date().toISOString(), confirmed: false,
    };
    parsed.pendingItems = [...(parsed.pendingItems || []), pending];
    this.run('UPDATE nodes SET properties = ?, updated_at = ? WHERE name = ? AND type = ?',
      [JSON.stringify(parsed), new Date().toISOString(), personName, 'person']);
    this.markDirty();
  }

  /**
   * v1.1: 清理 30 天以上未确认的 pending 条目
   */
  cleanExpiredPendingItems(): number {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const persons = this.query('SELECT id, name, properties FROM nodes WHERE type = ?', ['person']);
    let total = 0;
    for (const node of persons) {
      try {
        const props = node.properties ? JSON.parse(node.properties) : {};
        const items: PendingItem[] = props.pendingItems || [];
        const before = items.length;
        props.pendingItems = items.filter(i => i.timestamp >= cutoff || i.confirmed);
        if (props.pendingItems.length < before) {
          total += before - props.pendingItems.length;
          this.run('UPDATE nodes SET properties = ?, updated_at = ? WHERE id = ?',
            [JSON.stringify(props), new Date().toISOString(), node.id]);
        }
      } catch { /* skip */ }
    }
    if (total > 0) { this.markDirty(); console.log(`[FamilyGraph] 清理 ${total} 条过期 pending`); }
    return total;
  }

  /**
   * v1.1: 从对话文本中提取人物档案信息（ProfileExtractor）
   * 规则：
   *   - 履历/特质类（traits/interests）：只追加不覆盖
   *   - 基础信息/关系类（occupation/relation_to_user）：仅高置信度可覆盖
   *   - 冲突信息：标记为 pending 而非直接覆盖
   *
   * @param personName 目标人物名
   * @param conversationText 对话原文（用于提取上下文）
   * @returns 本次提取到的字段数
   */
  async extractProfileFromText(personName: string, conversationText: string): Promise<number> {
    const profile = this.getPersonProfile(personName);
    if (!profile || !conversationText) return 0;

    let extracted = 0;

    // 1. 提取职业/身份（高置信度模式：包含"是"的声明句）
    const occupationMatch = conversationText.match(new RegExp(`${personName}(?:是|做|从事|在.+?担任)([^，。！？]{2,20}(?:工作|一职|岗位|职位|老师|医生|工程师|经理|主管|员)?)`));
    if (occupationMatch && !profile.occupation) {
      const occupation = occupationMatch[1].substring(0, 30);
      await this.updatePersonProfile(personName, { occupation } as any);
      extracted++;
    }

    // 2. 提取性格标签（低置信度追加模式）
    const traitHints = [
      { regex: /开朗|外向|活泼/, value: '开朗' },
      { regex: /内向|安静|腼腆/, value: '内向' },
      { regex: /温柔|温和|脾气好/, value: '温柔' },
      { regex: /急脾气|暴躁|火爆/, value: '急躁' },
      { regex: /幽默|风趣|搞笑/, value: '幽默' },
      { regex: /细心|细致|心细/, value: '细心' },
      { regex: /大方|豪爽/, value: '大方' },
      { regex: /勤快|勤奋/, value: '勤奋' },
      { regex: /懒惰|懒散/, value: '懒散' },
      { regex: /乐观/, value: '乐观' },
      { regex: /悲观/, value: '悲观' },
      { regex: /热心|乐于助人/, value: '热心' },
      { regex: /固执|要强/, value: '固执' },
      { regex: /贤惠|体贴|顾家/, value: '顾家' },
      { regex: /善良|心软/, value: '善良' },
      { regex: /成熟|稳重/, value: '稳重' },
      { regex: /大方|不小气/, value: '大方' },
    ];
    const newTraits: string[] = [];
    for (const hint of traitHints) {
      if (hint.regex.test(conversationText)) {
        const existing = profile.traits || [];
        if (!existing.includes(hint.value)) {
          newTraits.push(hint.value);
        }
      }
    }
    if (newTraits.length > 0) {
      const merged = [...(profile.traits || []), ...newTraits];
      await this.updatePersonProfile(personName, { traits: merged } as any);
      extracted += newTraits.length;
    }

    // 3. 提取关系描述
    const relationNoteMatch = conversationText.match(new RegExp(`${personName}(?:是|算|属于)(?:我的|我)?([^，。！？]{2,20}(?:朋友|同学|同事|亲戚|邻居|合伙人|搭档|合作伙伴))`));
    if (relationNoteMatch && relationNoteMatch[1]) {
      const note = relationNoteMatch[1].substring(0, 30);
      if (!profile.relation_to_user) {
        await this.updatePersonProfile(personName, { relation_to_user: note } as any);
        extracted++;
      } else if (profile.relation_to_user !== note) {
        await this.addPendingItem(personName, 'relationMap.relationToUser', note, conversationText.substring(0, 80));
        extracted++;
      }
    }

    // 4. 提取爱好（追加模式）
    const interestHints = [
      /喜欢|爱好|爱看|爱听|爱玩|爱打|爱去|爱做/,
      /热爱|酷爱|迷恋/,
    ];
    for (const hint of interestHints) {
      const interestMatch = conversationText.match(hint);
      if (interestMatch) {
        const detailMatch = conversationText.match(new RegExp(`${interestMatch[0]}([^，。！？]{2,20})`));
        if (detailMatch) {
          const interest = detailMatch[1].substring(0, 15);
          if (!(profile.interests || []).includes(interest) && interest.length >= 2) {
            const merged = [...(profile.interests || []), interest];
            await this.updatePersonProfile(personName, { interests: merged } as any);
            extracted++;
          }
        }
      }
    }

    // 5. 提取外貌描述
    const appearanceMatch = conversationText.match(new RegExp(`${personName}(?:长?得?|长相|样子|看起来)([^，。！？]{3,30})`));
    if (appearanceMatch && appearanceMatch[1].length >= 3) {
      const desc = appearanceMatch[1].substring(0, 40);
      if (!profile.appearance && !profile.dossier?.imageTraits?.looks) {
        await this.updatePersonProfile(personName, { appearance: desc } as any);
        extracted++;
      } else if (profile.appearance && profile.appearance !== desc) {
        await this.addPendingItem(personName, 'appearance', desc, conversationText.substring(0, 80));
        extracted++;
      }
    }

    // ── v1.2 新增提取规则 ──

    // 6. 提取联系方式（电话/微信/地址）
    const phoneMatch = conversationText.match(/(?:电话|手机|打给我|联系)(?:\s*[:：]?\s*)(1[3-9]\d{9})/);
    if (phoneMatch) {
      const phone = phoneMatch[1];
      if (profile.dossier?.contact?.phone !== phone) {
        const dossier = this.getFullProfile(personName) || this.buildDossierFromFlat(profile, {});
        dossier.contact.phone = phone;
        await this.updatePersonProfile(personName, {} as any);
        extracted++;
      }
    }
    const wechatMatch = conversationText.match(/(?:微信|WeChat|wx)(?:\s*[:：]?\s*)([a-zA-Z0-9_]{4,30})/);
    if (wechatMatch) {
      const wechat = wechatMatch[1];
      await this.addPendingItem(personName, 'contact.wechat', wechat, conversationText.substring(0, 80));
      extracted++;
    }

    // 7. 提取年龄/出生年份
    const ageMatch = conversationText.match(/(?:今年|现在)(\d{1,2})岁/);
    if (ageMatch) {
      const age = parseInt(ageMatch[1]);
      const birthYear = new Date().getFullYear() - age;
      await this.addPendingItem(personName, 'basicInfo.birthYear', String(birthYear), conversationText.substring(0, 80));
      extracted++;
    }

    // 8. 提取健康信息
    const healthMatch = conversationText.match(new RegExp(`${personName}.*?(?:身体|健康|生病|住院|吃药|手术|过敏|毛病)([^。！？]{2,30})`));
    if (healthMatch) {
      const healthInfo = healthMatch[0].substring(0, 40);
      await this.addPendingItem(personName, 'health.condition', healthInfo, conversationText.substring(0, 80));
      extracted++;
    }

    // 9. 提取工作单位/地点
    const workplaceMatch = conversationText.match(new RegExp(`${personName}.*?(?:在|任职于|工作于|在.*上班)([^，。！？]{2,20})`));
    if (workplaceMatch) {
      const workplace = workplaceMatch[1].substring(0, 20);
      await this.addPendingItem(personName, 'contact.workplace', workplace, conversationText.substring(0, 80));
      extracted++;
    }

    // 10. 提取人生大事（结婚/生子/毕业等）
    const milestoneMatch = conversationText.match(new RegExp(`${personName}.*?(?:结婚|生子|毕业|考上|入职|退休|去世|生病|住院|创业|开店)([^。！？]{2,30})`));
    if (milestoneMatch) {
      await this.addPendingItem(personName, 'lifeMilestones', milestoneMatch[0].substring(0, 40), conversationText.substring(0, 80));
      extracted++;
    }

    // 11. 提取家庭关系（XX的爸爸/妈妈/老婆/老公等）
    const familyRelMatch = conversationText.match(new RegExp(`${personName}(?:的|是)(?:爸爸|妈妈|父亲|母亲|老公|老婆|丈夫|妻子|儿子|女儿|孩子|哥哥|弟弟|姐姐|妹妹|兄弟|姐妹|爷爷|奶奶|外公|外婆)`));
    if (familyRelMatch) {
      const relation = familyRelMatch[0].substring(0, 20);
      await this.addPendingItem(personName, 'familyNetwork.extended', relation, conversationText.substring(0, 80));
      extracted++;
    }

    // ── v1.2 新增：与用户的交集提取 ──

    // 12. 提取结识场景（"我和XX是在XX认识的/认识的"）
    const metMatch = conversationText.match(new RegExp(`(?:我和|我和|与)${personName}(?:是在|是在|是)([^，。！？]{2,30})(?:认识的|认识的|认识的|见面|相遇|碰到的)`));
    if (metMatch) {
      const metWhen = metMatch[1].substring(0, 30);
      await this.addPendingItem(personName, 'relationMap.intersections.metWhen', metWhen, conversationText.substring(0, 80));
      extracted++;
    }

    // 13. 提取共事记录（"一起/合作/同事/项目/共事"）
    const workMatch = conversationText.match(new RegExp(`${personName}(?:和我|同我|跟我)?(?:一起|一同|合作|共事|搭档|合伙|共同)(?:做|搞|负责|参与|创业|经营|管理)([^，。！？]{2,40})`));
    if (workMatch) {
      const workTogether = workMatch[0].substring(0, 50);
      await this.addPendingItem(personName, 'relationMap.intersections.workTogether', workTogether, conversationText.substring(0, 80));
      extracted++;
    }

    // 14. 提取生活交集（"一起去过/一起吃饭/我们经常"）
    const lifeMatch = conversationText.match(new RegExp(`${personName}(?:和我|同我|跟我)?(?:一起|经常|偶尔|有时)(?:去|来|吃|喝|玩|聚|见|约|住|走)([^，。！？]{2,30})`));
    if (lifeMatch) {
      const lifeIntersection = lifeMatch[0].substring(0, 40);
      await this.addPendingItem(personName, 'relationMap.intersections.lifeIntersection', lifeIntersection, conversationText.substring(0, 80));
      extracted++;
    }

    // 15. 提取情感评价（"信得过/讨厌/信任/很看重/不喜欢"）
    const emotionMatch = conversationText.match(new RegExp(`对${personName}(?:很|非常|挺|特别|有点|有些|一向)(?:信赖|信任|看重|欣赏|佩服|尊敬|感恩|感激|讨厌|反感|不满|失望|嫌弃|依赖|依靠|忌惮|防备)`));
    if (emotionMatch) {
      const assessment = emotionMatch[0].substring(0, 30);
      await this.addPendingItem(personName, 'relationMap.intersections.emotionalAssessment', assessment, conversationText.substring(0, 80));
      extracted++;
    }

    // 16. 提取利益关系（"我的客户/合伙人/供应商/老板"）
    const interestMatch = conversationText.match(new RegExp(`${personName}(?:是|算|属于)我的(?:客户|供应商|合伙人|合作伙伴|老板|上级|下属|员工|同事|搭档|乙方|甲方|代理商|渠道商|股东|投资人)`));
    if (interestMatch) {
      const interestRelation = interestMatch[0].substring(0, 20);
      await this.addPendingItem(personName, 'relationMap.intersections.interestRelation', interestRelation, conversationText.substring(0, 80));
      extracted++;
    }

    // ── v1.2 新增：女性详细体征提取（非家人女性） ──

    // 17. 提取整体印象/气质
    const impressionMatch = conversationText.match(new RegExp(`${personName}.*?(?:第一印象|给人的感觉|气质|那种|一看就是|看起来)([^。！？]{3,30})`));
    if (impressionMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.firstImpression', impressionMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 18. 提取身高体型描述（含三围/身材数据）
    const statureMatch = conversationText.match(new RegExp(`${personName}.*?(?:身高|一米[五六七八九]|身材|个子|体型|三围|胸围|腰围|臀围|匀称|苗条|丰满|娇小|高挑|修长|性感|火辣)([^。！？]{3,30})`));
    if (statureMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.stature', statureMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 19. 提取胸部特征
    const breastMatch = conversationText.match(new RegExp(`${personName}.*?(?:胸|乳房|乳沟|奶子|胸部|乳晕|乳头|胸型|罩杯|丰满|平胸|微乳|大胸|巨乳|椒乳|酥胸|双峰)([^。！？]{2,30})`));
    if (breastMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.breasts', breastMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 20. 提取臀部/腰/腿特征
    const bodyPartMatch = conversationText.match(new RegExp(`${personName}.*?(?:臀|屁股|翘臀|蜜桃臀|圆润|腰|细腰|小蛮腰|水蛇腰|蜜桃|美腿|大腿|长腿|玉腿|腿型|小腿|修长|笔直|性感)([^。！？]{2,30})`));
    if (bodyPartMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.buttocks', bodyPartMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 21. 提取皮肤描述
    const skinMatch = conversationText.match(new RegExp(`${personName}.*?(?:皮肤|肌肤|肤质|雪白|白皙|嫩滑|光滑|细腻|吹弹可破|冰肌玉骨|小麦色|古铜|白嫩|弹性|体温|温热|冰凉)([^。！？]{2,30})`));
    if (skinMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.skin', skinMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 22. 提取唇/眼/发特征
    const lookMatch = conversationText.match(new RegExp(`${personName}.*?(?:嘴唇|双唇|红唇|性感|丰唇|薄唇|眼睛|眼神|双眸|眼眸|瞳孔|桃花眼|丹凤眼|睫毛|秀发|长发|青丝|发丝|发质|马尾|披肩发|短发|卷发|直发|发香)([^。！？]{2,30})`));
    if (lookMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.lips', lookMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 23. 提取体味/体香/香水
    const scentMatch = conversationText.match(new RegExp(`${personName}.*?(?:体味|体香|香水|味道|气味|香|气息|芬芳|幽香|清香|淡香|浓郁|奶香|花|栀子|玫瑰|茉莉|檀香|麝香)([^。！？]{2,30})`));
    if (scentMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.bodyScent', scentMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 24. 提取性感/魅惑描述
    const allureMatch = conversationText.match(new RegExp(`${personName}.*?(?:性感|魅惑|妩媚|妖娆|撩人|迷人|勾人|摄魂|风骚|骚|浪|淫荡|风情|韵味|诱惑|挑逗|销魂|让人受不了|把持不住|欲火)([^。！？]{2,30})`));
    if (allureMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.allure', allureMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 25. 提取触感描述
    const touchMatch = conversationText.match(new RegExp(`${personName}.*?(?:手感|触感|抚摸|接触|温软|柔软|柔滑|细腻|紧致|弹性|炙热|滚烫|冰凉|润滑|湿润|嫩滑)([^。！？]{2,30})`));
    if (touchMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.touch', touchMatch[0].substring(0, 50), conversationText.substring(0, 80));
      extracted++;
    }

    // 26. 提取特殊记忆点
    const memMatch = conversationText.match(new RegExp(`${personName}.*?(?:最让人|最令我|印象最深|忘不了|怀念|想念|回味|魂牵梦萦|念念不忘|挥之不去)([^。！？]{3,40})`));
    if (memMatch) {
      await this.addPendingItem(personName, 'imageTraits.feminineDetails.memorableTraits', memMatch[0].substring(0, 60), conversationText.substring(0, 80));
      extracted++;
    }

    return extracted;
  }

  /**
   * v1.1: 全量补全缺失的反向边
   * 遍历所有边，确保有正向边必有反向边，无单向断链
   */
  completeReverseEdges(): { completed: number; errors: number } {
    let completed = 0, errors = 0;

    const allEdges = this.query(
      'SELECT e.source_id, e.target_id, e.relation, a.name as srcName, b.name as tgtName FROM edges e JOIN nodes a ON e.source_id = a.id JOIN nodes b ON e.target_id = b.id'
    );

    for (const edge of allEdges) {
      const reverseRel = REVERSE_RELATION[edge.relation] || SOCIAL_REVERSE[edge.relation];
      if (!reverseRel || reverseRel === edge.relation) continue; // 自反关系（spouse_of, friend_of）无需补全

      const existing = this.query(
        'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
        [edge.target_id, edge.source_id, reverseRel]
      );
      if (existing.length === 0) {
        try {
          this.run('INSERT INTO edges (id, source_id, target_id, relation, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [uid(), edge.target_id, edge.source_id, reverseRel, '{}', new Date().toISOString(), new Date().toISOString()]);
          completed++;
        } catch { errors++; }
      }
    }

    if (completed > 0) {
      this.markDirty(true);
      console.log(`[FamilyGraph] 反向边补全: ${completed} 条新增, ${errors} 错误`);
    }
    return { completed, errors };
  }

  /**
   * v1.1: 从备份文件恢复图谱（轻量回滚）
   * 恢复前自动备份当前版本，恢复后自行校验完整性
   */
  async restoreFromBackup(backupPath: string): Promise<{ success: boolean; error?: string; preBackupPath?: string; verified: boolean }> {
    const { existsSync, copyFileSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');

    // 1. 自动备份当前版本
    const preBackupPath = this.dbPath + '.pre-restore.' + Date.now() + '.bak';
    try {
      const currentData = this.db!.export();
      writeFileSync(preBackupPath, Buffer.from(currentData));
    } catch (e) {
      return { success: false, error: `当前版本备份失败: ${e}`, preBackupPath, verified: false };
    }

    // 2. 检查备份文件
    if (!existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在', preBackupPath, verified: false };
    }

    // 3. 验证备份文件可读性
    try {
      const SQL = await initSqlJs();
      const backupData = await import('node:fs').then(fs => fs.readFileSync(backupPath));
      const testDb = new SQL.Database(backupData);
      const nodes = testDb.exec('SELECT COUNT(*) as cnt FROM nodes');
      const edges = testDb.exec('SELECT COUNT(*) as cnt FROM edges');
      const nodeCnt = nodes[0]?.values[0]?.[0] || 0;
      const edgeCnt = edges[0]?.values[0]?.[0] || 0;
      testDb.close();
      if (nodeCnt === 0) {
        return { success: false, error: '备份文件无效（nodes 表为空）', preBackupPath, verified: false };
      }
    } catch (e) {
      return { success: false, error: `备份文件不可读: ${e}`, preBackupPath, verified: false };
    }

    // 4. 替换当前库
    try {
      copyFileSync(backupPath, this.dbPath);
      // 重新加载
      const SQL = await initSqlJs();
      const buffer = await import('node:fs').then(fs => fs.readFileSync(this.dbPath));
      this.db = new SQL.Database(buffer);
      console.log(`[FamilyGraph] 已从备份恢复: ${backupPath}`);
    } catch (e) {
      return { success: false, error: `恢复失败: ${e}`, preBackupPath, verified: false };
    }

    return { success: true, preBackupPath, verified: true };
  }

  /**
   * v1.1: 获取备份状态统计
   */
  getBackupStats(): { personCount: number; edgeCount: number; reverseEdgeRatio: number } {
    const persons = this.query("SELECT COUNT(*) as cnt FROM nodes WHERE type = 'person'");
    const edges = this.query('SELECT COUNT(*) as cnt FROM edges');
    const edgeCnt = edges[0]?.cnt ?? 0;

    // 计算反向边比例：自反关系（spouse_of/friend_of）在每个 pair 中应出现 2 次
    const pairsWithBoth = this.query(
      `SELECT COUNT(*) as cnt FROM (
        SELECT e1.source_id, e1.target_id FROM edges e1
        INNER JOIN edges e2 ON e1.source_id = e2.target_id AND e1.target_id = e2.source_id
        WHERE e1.relation != e2.relation
        GROUP BY e1.source_id, e1.target_id
      )`
    );
    const bothCount = pairsWithBoth[0]?.cnt ?? 0;
    const totalPairs = this.query(
      `SELECT COUNT(*) as cnt FROM (SELECT DISTINCT source_id, target_id FROM edges)`
    );
    const pairCnt = totalPairs[0]?.cnt ?? 1;

    return {
      personCount: persons[0]?.cnt ?? 0,
      edgeCount: edgeCnt,
      reverseEdgeRatio: Math.round(bothCount / Math.max(1, pairCnt) * 100) / 100,
    };
  }

  /**
   * v1.1: 使用 EntityValidator 校验档案字段
   */
  validateDossierField(field: string, value: string): { valid: boolean; reason?: string } {
    switch (field) {
      case 'name': return validatePersonName(value);
      case 'relation': return validateRelationType(value);
      case 'gender':
        if (value && !['男', '女', '未知'].includes(value)) return { valid: false, reason: '性别只能为男/女/未知' };
        return { valid: true };
      case 'traits':
        if (value && value.length > 10) return { valid: false, reason: '性格标签过长' };
        return { valid: true };
      default:
        if (value && value.length > 200) return { valid: false, reason: '字段值超过200字符' };
        return { valid: true };
    }
  }

  /**
   * 获取人物画像摘要（用于对话注入）
   */
  getPersonSummary(personName: string): string | null {
    const profile = this.getPersonProfile(personName);
    if (!profile) return null;
    const parts: string[] = [personName];
    if (profile.relation_to_user) parts.push(profile.relation_to_user);
    if (profile.occupation) parts.push('做' + profile.occupation);
    if (profile.traits && profile.traits.length > 0) parts.push('性格' + profile.traits.join('/'));
    return parts.join('，');
  }

  /**
   * P0-3: 获取所有已知人员姓名（用于幻觉校验）
   */
  getAllPersonNames(): string[] {
    const rows = this.query('SELECT name FROM nodes WHERE type = ?', ['person']);
    return (rows as any[]).map(r => r.name as string).filter(Boolean);
  }

  /**
   * S2-3: 清洗关系词脏节点
   * 删除「老公/老婆/爸爸/妈妈/同事/朋友」等关系词被误作为人名创建的节点
   */
  async cleanDirtyNodes(): Promise<number> {
    const dirtyWords = ['老公','老婆','爸爸','妈妈','爷爷','奶奶','外公','外婆',
      '哥哥','弟弟','姐姐','妹妹','儿子','女儿','同事','同学','朋友','室友',
      '老板','上司','领导','客户','老师','医生','邻居','合伙人'];
    let cleaned = 0;

    for (const word of dirtyWords) {
      const nodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [word, 'person']);
      for (const node of nodes) {
        const profile = this.getPersonProfile(word);
        // 仅当该节点没有有效的人物画像信息时删除（仅关系词，无其他属性）
        if (profile && !profile.appearance && !profile.body_features && !profile.occupation
            && !profile.traits?.length && !profile.description && !profile.interests?.length) {
          // 删除关联边
          this.run('DELETE FROM edges WHERE source_id = ? OR target_id = ?', [node.id, node.id]);
          this.run('DELETE FROM nodes WHERE id = ?', [node.id]);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      console.log(`[FamilyGraph] 清洗 ${cleaned} 个脏节点`);
      this.markDirty(true);
    }
    return cleaned;
  }

  /**
   * S2-3: 检索人物时联动返回档案 + 关联记忆
   * 返回人物画像 + 关联的 edges 列表（供 chat.ts 构建检索）
   */
  searchPersonWithMemories(personName: string): {
    profile: PersonProfile | null;
    relations: Array<{ name: string; relation: string }>;
  } {
    const profile = this.getPersonProfile(personName);
    const relations: Array<{ name: string; relation: string }> = [];

    if (profile) {
      const nodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
      if (nodes.length > 0) {
        const nodeId = nodes[0].id;
        // 出边
        const outgoing = this.query(
          `SELECT n.name, e.relation FROM edges e JOIN nodes n ON e.target_id = n.id WHERE e.source_id = ?`,
          [nodeId]
        );
        for (const e of outgoing) {
          relations.push({ name: e.name, relation: e.relation });
        }
        // 入边
        const incoming = this.query(
          `SELECT n.name, e.relation FROM edges e JOIN nodes n ON e.source_id = n.id WHERE e.target_id = ?`,
          [nodeId]
        );
        for (const e of incoming) {
          relations.push({ name: e.name, relation: e.relation });
        }
      }
    }

    return { profile, relations };
  }

  /**
   * S2-3: 特征独立建边
   * 为人物外貌/身体特征创建独立的 object 节点并关联
   */
  async addFeatureEdge(personName: string, featureName: string, featureType: 'appearance' | 'body' | 'style' | 'trait'): Promise<void> {
    const personNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (personNodes.length === 0) return;
    const personId = personNodes[0].id;

    // 查找或创建特征节点
    const featureNodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [featureName, 'object']);
    let featureId: string;
    if (featureNodes.length > 0) {
      featureId = featureNodes[0].id;
    } else {
      featureId = uid();
      await this.addNode({ id: featureId, type: 'object', name: featureName });
    }

    // 建边
    const relation = featureType === 'appearance' ? 'has_appearance' :
      featureType === 'body' ? 'has_body_feature' :
      featureType === 'style' ? 'has_style' : 'has_trait';
    const existing = this.query(
      'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      [personId, featureId, relation]
    );
    if (existing.length === 0) {
      await this.addEdge({ id: uid(), source_id: personId, target_id: featureId, relation });
      console.log(`[FamilyGraph] 特征建边: ${personName} -${relation}-> ${featureName}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 双库统一兼容层（返回 entity_relations 兼容格式）
  // ════════════════════════════════════════════════════════════

  /**
   * 获取指定人物的关联人物（兼容 entity_relations 格式）
   * 返回 {name, relation, strength}[] 格式
   */
  getRelatedPersons(personName: string): Array<{ name: string; relation: string; strength: number }> {
    const results: Array<{ name: string; relation: string; strength: number }> = [];
    const nodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [personName, 'person']);
    if (nodes.length === 0) return results;

    const nodeId = nodes[0].id;

    // 出边（此人认识谁）
    const outgoing = this.query(
      `SELECT n.name, e.relation FROM edges e JOIN nodes n ON e.target_id = n.id WHERE e.source_id = ?`,
      [nodeId]
    );
    for (const e of outgoing) {
      results.push({ name: e.name, relation: e.relation, strength: 1.0 });
    }

    // 入边（谁认识此人）
    const incoming = this.query(
      `SELECT n.name, e.relation FROM edges e JOIN nodes n ON e.source_id = n.id WHERE e.target_id = ?`,
      [nodeId]
    );
    for (const e of incoming) {
      results.push({ name: e.name, relation: e.relation, strength: 1.0 });
    }

    return results;
  }

  /**
   * 批量获取关联人物（兼容 findRelatedEntities 格式）
   * 对每个实体名查 FamilyGraph 并合并结果
   */
  getRelatedPersonsBatch(entityNames: string[], minStrength = 0.3): Array<{ name: string; relation: string; strength: number }> {
    const results: Array<{ name: string; relation: string; strength: number }> = [];
    const seen = new Set<string>();

    for (const name of entityNames) {
      const rels = this.getRelatedPersons(name);
      for (const r of rels) {
        if (!seen.has(r.name) && r.strength >= minStrength) {
          seen.add(r.name);
          results.push(r);
        }
      }
      // 如果该名字本身就是人物节点，也算入关联
      if (!seen.has(name) && entityNames.includes(name)) {
        const profile = this.getPersonProfile(name);
        if (profile?.relation_to_user) {
          seen.add(name);
          results.push({ name, relation: 'known_person', strength: 0.5 });
        }
      }
    }
    return results;
  }

  /**
   * N跳关联人物检索（兼容 findRelatedEntitiesN 格式）
   */
  getRelatedPersonsN(entityNames: string[], maxHops: 1|2|3 = 1, minStrength = 0.3): Array<{ name: string; relation: string; strength: number; hop: number }> {
    const results: Array<{ name: string; relation: string; strength: number; hop: number }> = [];
    const seen = new Set<string>(entityNames);
    let currentLayer = entityNames.filter(n => {
      const nodes = this.query('SELECT id FROM nodes WHERE name = ? AND type = ?', [n, 'person']);
      return nodes.length > 0;
    });
    let hop = 1;

    while (hop <= maxHops && currentLayer.length > 0 && results.length < 8) {
      const nextLayer: string[] = [];
      for (const name of currentLayer) {
        const rels = this.getRelatedPersons(name);
        for (const r of rels) {
          if (seen.has(r.name)) continue;
          seen.add(r.name);
          if (r.strength >= minStrength) {
            results.push({ ...r, hop });
            nextLayer.push(r.name);
            if (results.length >= 8) break;
          }
        }
        if (results.length >= 8) break;
      }
      currentLayer = nextLayer;
      hop++;
    }

    return results;
  }

  /**
   * 获取图谱统计信息（用于健康检查）
   */
  getStats(): { personCount: number; edgeCount: number; locationCount: number; objectCount: number } {
    const persons = this.query('SELECT COUNT(*) as cnt FROM nodes WHERE type = ?', ['person']);
    const edges = this.query('SELECT COUNT(*) as cnt FROM edges');
    const locations = this.query('SELECT COUNT(*) as cnt FROM nodes WHERE type = ?', ['place']);
    const objects = this.query('SELECT COUNT(*) as cnt FROM nodes WHERE type = ?', ['object']);
    return {
      personCount: (persons[0] as any)?.cnt ?? 0,
      edgeCount: (edges[0] as any)?.cnt ?? 0,
      locationCount: (locations[0] as any)?.cnt ?? 0,
      objectCount: (objects[0] as any)?.cnt ?? 0,
    };
  }

  /**
   * 获取所有边摘要（用于 debug API）
   */
  getAllEdgesSummary(): Array<{ entityA: string; entityB: string; relation: string; strength: number }> {
    const results = this.query(
      `SELECT a.name as entityA, b.name as entityB, e.relation
       FROM edges e
       JOIN nodes a ON a.id = e.source_id
       JOIN nodes b ON b.id = e.target_id
       ORDER BY e.created_at DESC
       LIMIT 50`,
    );
    return (results as any[]).map(r => ({
      entityA: r.entityA,
      entityB: r.entityB,
      relation: r.relation,
      strength: 1.0,
    }));
  }

  private rowToNode(row: any): GraphNode {
    return {
      id: row.nid ?? row.id,
      type: row.ntype ?? row.type,
      name: row.nname ?? row.name,
      aliases: row.aliases ? JSON.parse(row.aliases) : undefined,
      properties: row.properties ? JSON.parse(row.properties) : undefined,
    };
  }
}
