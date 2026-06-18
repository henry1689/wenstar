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
  mother_of: 'child_of', father_of: 'child_of',
  spouse_of: 'spouse_of',
  sibling_of: 'sibling_of',
  grandfather_of: 'grandchild_of', grandmother_of: 'grandchild_of',
  child_of: 'parent_of',
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

    this.save();
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
    this.save();
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
    this.save();
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

    for (const person of persons) {
      // 检查该人名是否在 kinship 词表中
      const kinshipWord = Object.keys(KINSHIP_MAP).find((kw) => rawInput.includes(kw));
      if (kinshipWord) {
        const relation = KINSHIP_MAP[kinshipWord];

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
        } else {
          personId = existing[0].id;
        }

        // 检查是否已有此边（防止重复）
        const existingEdge = this.query(
          'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
          [userId, personId, relation]
        );
        if (existingEdge.length === 0) {
          await this.addEdge({
            id: uid(),
            source_id: userId,
            target_id: personId,
            relation,
          });
          edgesCreated++;
          details.push(`创建边: ${userName} --${relation}--> ${person.name}`);

          // 自动创建反向边
          const reverseRel = REVERSE_RELATION[relation];
          if (reverseRel && reverseRel !== relation) {
            const revEdge = this.query(
              'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
              [personId, userId, reverseRel]
            );
            if (revEdge.length === 0) {
              await this.addEdge({
                id: uid(),
                source_id: personId,
                target_id: userId,
                relation: reverseRel,
              });
              edgesCreated++;
              details.push(`创建反向边: ${person.name} --${reverseRel}--> ${userName}`);
            }
          }
        } else {
          details.push(`边已存在: ${userName} --${relation}--> ${person.name}`);
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

    this.save();
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
    } else {
      personId = existing[0].id;
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
   * 获取社交关系摘要（与 getFamilySummary 互补，只返回非家庭关系）
   * 同一人若同时有家族边和社交边，在两个摘要中都会出现。
   */
  async getSocialSummary(): Promise<{ connections: Array<{ name: string; relation_to_user: string }> }> {
    const connections: Array<{ name: string; relation_to_user: string }> = [];
    // 实时查询"我"节点，不依赖缓存的 userNodeId（重启后可能为 null）
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
            connections.push({
              name: node.name,
              relation_to_user: this.describeSocialRelation(edge.relation),
            });
            break; // 一个人只出现一次
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

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
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
