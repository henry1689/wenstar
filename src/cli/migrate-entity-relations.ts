/**
 * 🚚 家族图谱双库统一 · 数据迁移脚本
 *
 * 四步法：预迁移 → 试运行 → 正式迁移 → 校验
 *
 * 用途：将 fusion_memory.db 中 entity_relations 表的人物关系数据
 * 迁移到 FamilyGraph 主库 (family_graph.db)
 *
 * 运行: npx tsx src/cli/migrate-entity-relations.ts
 * 选项:
 *   --dry-run     只读对比，不写数据（预迁移）
 *   --trial       迁移到临时表（试运行）
 *   --run         正式迁移
 *   --verify      全量校验
 *   --all         四步全部执行
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(PROJECT_ROOT, 'data', 'webui');
const FG_DB_PATH = join(PROJECT_ROOT, 'data', 'knowledge', 'family_graph.db');
const FM_DB_PATH = join(DATA_DIR, 'fusion_memory.db');

// ─── 噪音词表（与 EntityValidator 保持一致） ───
const NOISE_WORDS = new Set([
  '那么快','平常我','和姐姐','周都去','方便现','老院','家人们','段很好',
  '左右','周二','周都','陈斌','方的','时你','管你','老想','单员',
  '简称嘛','小学','平常人','小镇','阴历','农历','周说','金库','项目在',
  '水彩画','从前','厉害','时我我','那一刻','那年',
  '应该','时候','强度','索引','关联','相遇','相似','职责','这里','那里',
]);

const SURNAMES = new Set(
  '赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公'
);

// 关系类型映射（entity_relations → FamilyGraph 边类型）
const RELATION_MAP: Record<string, string> = {
  '认识的人': 'acquaintance_of',
  '配偶': 'spouse_of', '老公': 'spouse_of', '老婆': 'spouse_of',
  '父亲': 'father_of', '妈妈': 'mother_of', '母亲': 'mother_of',
  '儿子': 'child_of', '女儿': 'child_of',
  '兄弟': 'sibling_of', '姐妹': 'sibling_of',
  '祖父': 'grandfather_of', '祖母': 'grandmother_of',
  '公婆': 'parent_of', '岳父母': 'parent_of',
};

const FAMILY_RELATIONS = new Set(['mother_of','father_of','spouse_of','sibling_of','child_of','grandfather_of','grandmother_of','parent_of','grandchild_of']);

interface MigrationReport {
  step: string;
  startTime: string;
  endTime: string;
  shadowStats: {
    totalRows: number;
    personEntities: number;
    personRelations: number;
  };
  fgStats: {
    personNodes: number;
    edges: number;
  };
  preMigration: {
    matched: number;
    conflict: number;
    unmatchedDiscarded: number;
    filteredNoise: number;
  };
  trialMigration: {
    newNodes: number;
    newEdges: number;
    errors: number;
  };
  formalMigration: {
    mergedNodes: number;
    mergedEdges: number;
    aliasesAdded: number;
    errors: number;
  };
  verification: {
    fgPersonCount: number;
    shadowPersonCount: number;
    matchedCount: number;
    missingInFg: string[];
    extraInFg: string[];
    dataComplete: boolean;
  };
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/**
 * 噪音词黑名单（从 entity_relations 观察到的所有非真实人名词汇）
 * 这些是被 M1 实体提取误分类为 'person' 的非人名词
 */
const NOISE_PERSON_NAMES = new Set([
  '丁点大','习成绩','储所','全部','全长变','公了','公司','公室','公桌下',
  '关上门','关心','别说','别说别','包子','包机','包裹','华般','单的','单员',
  '史摘','和事你','和你','和你现','和保护','和刺激','和她','和知性','和职责',
  '和舒服','和那种','家了','小小','小屄','小时','巴吧','平胸','强调','方便',
  '时哪里','时我们','时你','时简直','时舒服','明天','段很美','段落二','段话',
  '水淋淋','滑动','班呢','班的事','白衬衣','相似度','简直','经常','经是',
  '舒服','舒服死','花样叫','苗条','谢你','谢谢你','车载空','那个','那你说',
  '那同样','那条缝','那样嫩','那种','那种快','那边','那那年','阴毛','马上',
  '马达','鲁呢','方的','管你','老想','老院','段很好','左右','周二','周都',
  '周说','金库','项目在','水彩画','从前','厉害','时我我','那一刻','那年',
  '应该','时候','强度','索引','关联','相遇','相似','这里','那里',
  '小学','小镇','阴历','农历','平常人','平常我','那么快','简称嘛','周都去',
  '和姐姐','方便现','陈斌','家人们',
]);

/** 纯关系词（不是人名，是描述关系的词汇） */
const RELATION_WORDS = new Set([
  '老公','老婆','爸爸','妈妈','爷爷','奶奶','外公','外婆',
  '哥哥','弟弟','姐姐','妹妹','儿子','女儿','孙子','孙女',
  '公公','婆婆','岳父','岳母','同事','同学','朋友','秘书','客户',
  '亲戚','邻居','搭档','室友','老板','领导','上司','下属','部下',
  '医生','老师','学生','师父','师傅','顾问','合伙人','父亲','母亲','孩子',
]);

/**
 * 判断是否是真实的人名。
 * 策略：白名单优先（已经在 FamilyGraph 中的真实人名），然后严格校验。
 */
function isValidPersonName(name: string): boolean {
  if (name === '我' || name === '我自己') return true;
  if (!name || name.length < 2 || name.length > 5) return false;
  if (NOISE_PERSON_NAMES.has(name)) return false;
  if (RELATION_WORDS.has(name)) return false;
  // 允许常见口语称呼：阿X、老X、小X
  if (name.length === 2 && (name[0] === '阿' || name[0] === '老' || name[0] === '小') && /[一-鿿]/.test(name[1])) return true;
  // 姓名字符数≥2时检测姓氏
  if (name.length >= 2 && !SURNAMES.has(name[0])) return false;
  return true;
}

/** 判断是否是 FamilyGraph 中的真实人名（排除关系词和噪音） */
function isRealPersonInFG(name: string, fgPersons: Set<string>): boolean {
  return fgPersons.has(name) && !RELATION_WORDS.has(name) && !NOISE_PERSON_NAMES.has(name);
}

async function loadSQLite(path: string): Promise<any> {
  if (!existsSync(path)) return null;
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const buffer = readFileSync(path);
  return new SQL.Database(buffer);
}

function fgQuery(db: any, sql: string, params?: unknown[]): any[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function fgRun(db: any, sql: string, params?: unknown[]): void {
  db.run(sql, params);
}

function query(db: any, sql: string, params?: unknown[]): any[] {
  try {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 步骤①: 预迁移 — 只读对比，不写数据
// ═══════════════════════════════════════════════════════════════
async function preMigration(fmDb: any, fgDb: any): Promise<MigrationReport['preMigration']> {
  console.log('\n📋 [步骤①] 预迁移 — 只读对比分析\n');

  const result = { matched: 0, conflict: 0, unmatchedDiscarded: 0, filteredNoise: 0 };

  // 读取影子库中所有 person→person 的关系
  const shadowRelations = query(fmDb,
    `SELECT a.name as personA, b.name as personB, er.relation, er.strength
     FROM entity_relations er
     JOIN entities a ON a.id = er.entity_a_id
     JOIN entities b ON b.id = er.entity_b_id
     WHERE a.type IN ('person','self') AND b.type = 'person'
     ORDER BY er.strength DESC`
  );

  console.log(`  影子库找到 ${shadowRelations.length} 条 person→person 关系`);

  // 读取 FamilyGraph 中已有的人员
  const fgPersonRows = fgQuery(fgDb, "SELECT name FROM nodes WHERE type = 'person'");
  const fgPersons = new Set(fgPersonRows.map((r: any) => r.name));
  console.log(`  主库已有 ${fgPersons.size} 个人员节点`);

  // 分析 FG 中需要清理的噪音节点（关系词被误作人名）
  const fgNoiseNames = fgPersonRows
    .map((r: any) => r.name)
    .filter((n: string) => !isValidPersonName(n) || RELATION_WORDS.has(n))
    .filter((n: string) => n !== '我');
  if (fgNoiseNames.length > 0) {
    console.log(`  🗑️  FG 中存在 ${fgNoiseNames.length} 个需清理的噪音节点: ${fgNoiseNames.join(', ')}`);
  }

  const seen = new Set<string>();

  for (const rel of shadowRelations) {
    const key = `${rel.personA}|${rel.personB}|${rel.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 校验双方人名
    if (!isValidPersonName(rel.personA) || !isValidPersonName(rel.personB)) {
      result.filteredNoise++;
      continue;
    }

    // 检查主库是否已有此关系
    const nameA = rel.personA;
    const nameB = rel.personB;

    if (fgPersons.has(nameA) && fgPersons.has(nameB)) {
      // 双方都在主库中，检查关系边
      const nodeA = fgQuery(fgDb, "SELECT id FROM nodes WHERE name = ? AND type = 'person'", [nameA]);
      const nodeB = fgQuery(fgDb, "SELECT id FROM nodes WHERE name = ? AND type = 'person'", [nameB]);
      if (nodeA.length > 0 && nodeB.length > 0) {
        const edgeType = RELATION_MAP[rel.relation] || 'acquaintance_of';
        const existingEdge = fgQuery(fgDb,
          'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
          [nodeA[0].id, nodeB[0].id, edgeType]
        );
        if (existingEdge.length > 0) {
          result.matched++;
        } else {
          // 检查是否已有其他关系边
          const anyEdge = fgQuery(fgDb,
            'SELECT id FROM edges WHERE source_id = ? AND target_id = ?',
            [nodeA[0].id, nodeB[0].id]
          );
          if (anyEdge.length > 0) {
            result.conflict++; // 已有不同关系
          } else {
            result.unmatchedDiscarded++; // 需要迁移
          }
        }
      }
    } else {
      result.unmatchedDiscarded++; // 需要创建节点+边
    }
  }

  console.log(`  ✅ 已匹配: ${result.matched}`);
  console.log(`  ⚠️  冲突: ${result.conflict}`);
  console.log(`  📦 待迁移: ${result.unmatchedDiscarded}`);
  console.log(`  🗑️  过滤噪音: ${result.filteredNoise}`);

  return result;
}

// ═══════════════════════════════════════════════════════════════
// 步骤②③: 试运行 / 正式迁移
// ═══════════════════════════════════════════════════════════════
async function runMigration(fmDb: any, fgDb: any, dryRun: boolean): Promise<{ mergedNodes: number; mergedEdges: number; aliasesAdded: number; errors: number; noiseFiltered: number }> {
  const label = dryRun ? '试运行(只读)' : '正式迁移';
  console.log(`\n📦 [步骤${dryRun ? '②' : '③'}] ${label}\n`);

  const result = { mergedNodes: 0, mergedEdges: 0, aliasesAdded: 0, errors: 0, noiseFiltered: 0 };

  // 读取影子库中所有 person→person 的关系
  const shadowRelations = query(fmDb,
    `SELECT a.name as personA, b.name as personB, er.relation, er.strength
     FROM entity_relations er
     JOIN entities a ON a.id = er.entity_a_id
     JOIN entities b ON b.id = er.entity_b_id
     WHERE a.type IN ('person','self') AND b.type = 'person'
     ORDER BY er.strength DESC`
  );

  // 收集所有待迁移人名
  const allNames = new Set<string>();
  const edgesToAdd: Array<{ personA: string; personB: string; relation: string }> = [];

  for (const rel of shadowRelations) {
    if (!isValidPersonName(rel.personA) || !isValidPersonName(rel.personB)) {
      result.noiseFiltered++;
      continue;
    }
    allNames.add(rel.personA);
    allNames.add(rel.personB);

    // 去重：同一对人可能有多个关系行
    const key = `${rel.personA}|${rel.personB}|${RELATION_MAP[rel.relation] || 'acquaintance_of'}`;
    if (edgesToAdd.some(e => `${e.personA}|${e.personB}|${e.relation}` === key)) continue;
    edgesToAdd.push({
      personA: rel.personA,
      personB: rel.personB,
      relation: RELATION_MAP[rel.relation] || 'acquaintance_of',
    });
  }

  console.log(`  待迁移: ${allNames.size} 个人名, ${edgesToAdd.length} 条边`);
  if (dryRun) {
    console.log('  🟡 试运行模式 — 不执行任何写入\n');
    return { ...result, mergedNodes: allNames.size, mergedEdges: edgesToAdd.length };
  }

  // 正式写入
  let nodeCreated = 0;
  let edgeCreated = 0;
  let aliasAdded = 0;
  let errorCount = 0;

  // 1. 创建节点
  for (const name of allNames) {
    const existing = fgQuery(fgDb, "SELECT id FROM nodes WHERE name = ? AND type = 'person'", [name]);
    if (existing.length === 0) {
      try {
        fgRun(fgDb,
          'INSERT INTO nodes (id, type, name, aliases, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uid(), 'person', name, '[]', '{}', new Date().toISOString(), new Date().toISOString()]
        );
        nodeCreated++;
      } catch (e) {
        console.warn(`  创建节点失败: ${name}`, e);
        errorCount++;
      }
    } else {
      // 已存在，检查别名
      const existingAliases = JSON.parse(existing[0].aliases || '[]');
      if (!existingAliases.includes(name) && name !== existing[0].name) {
        existingAliases.push(name);
        try {
          fgRun(fgDb, 'UPDATE nodes SET aliases = ? WHERE id = ?',
            [JSON.stringify(existingAliases), existing[0].id]);
          aliasAdded++;
        } catch { errorCount++; }
      }
    }
  }

  // 2. 创建边
  for (const edge of edgesToAdd) {
    const nodeA = fgQuery(fgDb, "SELECT id FROM nodes WHERE name = ? AND type = 'person'", [edge.personA]);
    const nodeB = fgQuery(fgDb, "SELECT id FROM nodes WHERE name = ? AND type = 'person'", [edge.personB]);
    if (nodeA.length === 0 || nodeB.length === 0) {
      errorCount++;
      continue;
    }

    const existing = fgQuery(fgDb,
      'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      [nodeA[0].id, nodeB[0].id, edge.relation]
    );
    if (existing.length === 0) {
      try {
        fgRun(fgDb,
          'INSERT INTO edges (id, source_id, target_id, relation, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uid(), nodeA[0].id, nodeB[0].id, edge.relation, '{}', new Date().toISOString(), new Date().toISOString()]
        );
        edgeCreated++;

        // 创建反向边
        const REVERSE_MAP: Record<string, string> = {
          'mother_of': 'child_of', 'father_of': 'child_of',
          'spouse_of': 'spouse_of', 'sibling_of': 'sibling_of',
          'child_of': 'parent_of', 'grandfather_of': 'grandchild_of',
          'grandmother_of': 'grandchild_of', 'parent_of': 'child_of',
          'grandchild_of': 'grandfather_of',
          'acquaintance_of': 'acquaintance_of',
          'colleague_of': 'colleague_of', 'friend_of': 'friend_of',
          'classmate_of': 'classmate_of',
        };
        const reverseRel = REVERSE_MAP[edge.relation];
        if (reverseRel && reverseRel !== edge.relation) {
          const revExisting = fgQuery(fgDb,
            'SELECT id FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
            [nodeB[0].id, nodeA[0].id, reverseRel]
          );
          if (revExisting.length === 0) {
            fgRun(fgDb,
              'INSERT INTO edges (id, source_id, target_id, relation, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [uid(), nodeB[0].id, nodeA[0].id, reverseRel, '{}', new Date().toISOString(), new Date().toISOString()]
            );
            edgeCreated++;
          }
        }
      } catch (e) {
        console.warn(`  创建边失败: ${edge.personA}--${edge.relation}-->${edge.personB}`, e);
        errorCount++;
      }
    }
  }

  console.log(`  ✅ 创建节点: ${nodeCreated}`);
  console.log(`  ✅ 创建边: ${edgeCreated}`);
  console.log(`  ✅ 别名关联: ${aliasAdded}`);
  console.log(`  ⚠️  错误: ${errorCount}`);
  console.log(`  🗑️  过滤噪音: ${result.noiseFiltered}`);

  return { mergedNodes: nodeCreated, mergedEdges: edgeCreated, aliasesAdded: aliasAdded, errors: errorCount, noiseFiltered: result.noiseFiltered };
}

// ═══════════════════════════════════════════════════════════════
// 步骤④: 校验
// ═══════════════════════════════════════════════════════════════
async function verifyMigration(fmDb: any, fgDb: any): Promise<MigrationReport['verification']> {
  console.log('\n🔍 [步骤④] 校验 — 全量数据对比\n');

  // 影子库：所有有效的人物名
  const shadowPerson = query(fmDb,
    `SELECT DISTINCT name FROM entities WHERE type IN ('person','self')`
  );
  const shadowNames = new Set(
    shadowPerson.map((r: any) => r.name).filter(isValidPersonName)
  );
  shadowNames.delete('我'); // '我' 不是第三方人物

  // FamilyGraph：所有人物节点
  const fgNodes = fgQuery(fgDb, "SELECT name FROM nodes WHERE type = 'person'");
  const fgNames = new Set(fgNodes.map((r: any) => r.name));

  // 对比
  const missingInFg: string[] = [];
  const extraInFg: string[] = [];
  let matchedCount = 0;

  for (const name of shadowNames) {
    if (fgNames.has(name)) matchedCount++;
    else missingInFg.push(name);
  }

  for (const name of fgNames) {
    if (name === '我') continue;
    if (!shadowNames.has(name)) extraInFg.push(name);
  }

  const dataComplete = missingInFg.length === 0;

  console.log(`  影子库有效人物: ${shadowNames.size}`);
  console.log(`  主库人物节点: ${fgNames.size - 1}（不含'我'）`); // 减掉'我'
  console.log(`  匹配: ${matchedCount}`);
  console.log(`  主库缺失: ${missingInFg.length}`);
  console.log(`  主库多余: ${extraInFg.length}`);
  console.log(`  数据完整性: ${dataComplete ? '✅ 完整' : '🔴 不完整'}`);

  if (missingInFg.length > 0) {
    console.log(`  缺失人物（前10）: ${missingInFg.slice(0, 10).join(', ')}`);
  }
  if (extraInFg.length > 0) {
    console.log(`  多余人物（前10）: ${extraInFg.slice(0, 10).join(', ')}`);
  }

  return {
    fgPersonCount: fgNames.size,
    shadowPersonCount: shadowNames.size,
    matchedCount,
    missingInFg: missingInFg.slice(0, 20),
    extraInFg: extraInFg.slice(0, 20),
    dataComplete,
  };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const steps = {
    dryRun: args.includes('--dry-run') || args.includes('--all'),
    trial: args.includes('--trial') || args.includes('--all'),
    run: args.includes('--run') || args.includes('--all'),
    verify: args.includes('--verify') || args.includes('--all'),
  };

  // 如果没传任何参数，显示帮助
  if (!steps.dryRun && !steps.trial && !steps.run && !steps.verify) {
    console.log(`
🚚 家族图谱双库统一 · 数据迁移脚本

用法:
  npx tsx src/cli/migrate-entity-relations.ts [选项]

选项:
  --dry-run  步骤① 预迁移（只读对比）
  --trial    步骤② 试运行（迁移到临时表）
  --run      步骤③ 正式迁移
  --verify   步骤④ 校验
  --all      四步全部执行

示例:
  npx tsx src/cli/migrate-entity-relations.ts --dry-run   # 先分析差异
  npx tsx src/cli/migrate-entity-relations.ts --run        # 正式迁移
  npx tsx src/cli/migrate-entity-relations.ts --verify     # 校验结果
    `);
    return;
  }

  const report: MigrationReport = {
    step: args.join(' '),
    startTime: new Date().toISOString(),
    endTime: '',
    shadowStats: { totalRows: 0, personEntities: 0, personRelations: 0 },
    fgStats: { personNodes: 0, edges: 0 },
    preMigration: { matched: 0, conflict: 0, unmatchedDiscarded: 0, filteredNoise: 0 },
    trialMigration: { newNodes: 0, newEdges: 0, errors: 0 },
    formalMigration: { mergedNodes: 0, mergedEdges: 0, aliasesAdded: 0, errors: 0 },
    verification: { fgPersonCount: 0, shadowPersonCount: 0, matchedCount: 0, missingInFg: [], extraInFg: [], dataComplete: false },
  };

  console.log('═'.repeat(60));
  console.log('  家族图谱双库统一 · 数据迁移');
  console.log('  ' + new Date().toLocaleString('zh-CN'));
  console.log('═'.repeat(60));

  // 检查数据库
  if (!existsSync(FM_DB_PATH)) {
    console.error('🔴 影子库不存在:', FM_DB_PATH);
    process.exit(1);
  }

  console.log(`  影子库: ${FM_DB_PATH}`);
  console.log(`  主库:   ${FG_DB_PATH}`);

  const fmDb = await loadSQLite(FM_DB_PATH);
  if (!fmDb) { console.error('🔴 无法加载影子库'); process.exit(1); }

  // 如果主库不存在，先创建
  let fgDb: any;
  if (existsSync(FG_DB_PATH)) {
    fgDb = await loadSQLite(FG_DB_PATH);
  } else {
    console.log('🟡 主库不存在，将创建新库');
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    fgDb = new SQL.Database();
    // 创建表结构
    fgRun(fgDb, `CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
      aliases TEXT DEFAULT '[]', properties TEXT DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    fgRun(fgDb, `CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      relation TEXT NOT NULL, properties TEXT DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES nodes(id), FOREIGN KEY (target_id) REFERENCES nodes(id)
    )`);
    fgRun(fgDb, 'CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    fgRun(fgDb, 'CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)');
    fgRun(fgDb, 'CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)');
    fgRun(fgDb, 'CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)');
  }

  // 统计快照
  const shadowRows = query(fmDb, 'SELECT COUNT(*) as cnt FROM entity_relations');
  const shadowEntities = query(fmDb, "SELECT COUNT(*) as cnt FROM entities WHERE type = 'person'");
  const shadowPersonRels = query(fmDb,
    `SELECT COUNT(*) as cnt FROM entity_relations er
     JOIN entities a ON a.id = er.entity_a_id
     JOIN entities b ON b.id = er.entity_b_id
     WHERE a.type IN ('person','self') AND b.type = 'person'`
  );
  const fgPersons = fgQuery(fgDb, "SELECT COUNT(*) as cnt FROM nodes WHERE type = 'person'");
  const fgEdges = fgQuery(fgDb, 'SELECT COUNT(*) as cnt FROM edges');

  report.shadowStats = {
    totalRows: shadowRows[0]?.cnt ?? 0,
    personEntities: shadowEntities[0]?.cnt ?? 0,
    personRelations: shadowPersonRels[0]?.cnt ?? 0,
  };
  report.fgStats = {
    personNodes: fgPersons[0]?.cnt ?? 0,
    edges: fgEdges[0]?.cnt ?? 0,
  };

  console.log(`\n  影子库: ${report.shadowStats.totalRows} 行, ${report.shadowStats.personEntities} 个人物实体, ${report.shadowStats.personRelations} 条人物关系`);
  console.log(`  主库:   ${report.fgStats.personNodes} 个人物节点, ${report.fgStats.edges} 条边\n`);

  try {
    // 步骤①: 预迁移
    if (steps.dryRun) {
      report.preMigration = await preMigration(fmDb, fgDb);
    }

    // 步骤②: 试运行
    if (steps.trial) {
      // 试运行在内存中模拟（不开临时表，只输出统计）
      const trialResult = await runMigration(fmDb, fgDb, true);
      report.trialMigration = {
        newNodes: trialResult.mergedNodes,
        newEdges: trialResult.mergedEdges,
        errors: trialResult.errors,
      };
    }

    // 步骤③: 正式迁移
    if (steps.run) {
      const formalResult = await runMigration(fmDb, fgDb, false);
      report.formalMigration = {
        mergedNodes: formalResult.mergedNodes,
        mergedEdges: formalResult.mergedEdges,
        aliasesAdded: formalResult.aliasesAdded,
        errors: formalResult.errors,
      };
      // 保存主库
      const data = fgDb.export();
      writeFileSync(FG_DB_PATH, Buffer.from(data));
      console.log(`\n  💾 主库已保存: ${FG_DB_PATH}`);

      // 清理 FG 噪音节点（关系词被误作人名）
      console.log('\n🧹 清理 FamilyGraph 噪音节点...');
      const FG_NOISE_CLEANUP = ['亲戚','同事','客户','别说别','平胸','强调'];
      let cleaned = 0;
      for (const noise of FG_NOISE_CLEANUP) {
        const nodes = fgQuery(fgDb, "SELECT id FROM nodes WHERE name = ? AND type = 'person'", [noise]);
        for (const node of nodes) {
          fgRun(fgDb, 'DELETE FROM edges WHERE source_id = ? OR target_id = ?', [node.id, node.id]);
          fgRun(fgDb, 'DELETE FROM nodes WHERE id = ?', [node.id]);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        const cleanData = fgDb.export();
        writeFileSync(FG_DB_PATH, Buffer.from(cleanData));
        console.log(`  ✅ 清理 ${cleaned} 个噪音节点`);
      } else {
        console.log('  无需清理');
      }
    }

    // 步骤④: 校验
    if (steps.verify) {
      // 重新加载主库（如果有写入）
      if (steps.run && fgDb) {
        const data = fgDb.export();
        writeFileSync(FG_DB_PATH, Buffer.from(data));
      }
      if (existsSync(FG_DB_PATH)) {
        const verifyFgDb = await loadSQLite(FG_DB_PATH);
        if (verifyFgDb) {
          report.verification = await verifyMigration(fmDb, verifyFgDb);
          verifyFgDb.close();
        }
      }
    }
  } catch (err) {
    console.error('\n🔴 迁移过程异常:', err);
  }

  report.endTime = new Date().toISOString();

  // 输出报告
  console.log('\n' + '═'.repeat(60));
  console.log('  迁移报告');
  console.log('═'.repeat(60));
  console.log(JSON.stringify(report, null, 2));

  // 保存报告
  const reportPath = join(PROJECT_ROOT, 'data', 'reports', `migration-${Date.now()}.json`);
  const reportDir = join(PROJECT_ROOT, 'data', 'reports');
  if (!existsSync(reportDir)) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(reportDir, { recursive: true });
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  报告已保存: ${reportPath}`);

  // 清理
  fmDb.close();
  if (fgDb) fgDb.close();
}

main().catch(console.error);
