import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FamilyGraph } from '../FamilyGraph.js';

const TEST_DB = join(__dirname, '.test-family-graph.db');

describe('FamilyGraph — 基础操作', () => {
  let graph: FamilyGraph;

  beforeEach(async () => {
    graph = new FamilyGraph(TEST_DB);
    await graph.initialize();
  });

  afterEach(() => {
    try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); } catch {}
  });

  it('添加节点并查询', async () => {
    await graph.addNode({ id: 'n1', type: 'person', name: '李华' });
    const result = await graph.findRelated('李华');
    expect(result.length).toBe(1);
    expect(result[0].node.name).toBe('李华');
  });

  it('添加边并查询关系', async () => {
    await graph.addNode({ id: 'u1', type: 'person', name: '我' });
    await graph.addNode({ id: 'p1', type: 'person', name: '李华' });
    await graph.addEdge({ source_id: 'u1', target_id: 'p1', relation: 'mother_of' });
    const result = await graph.findRelated('李华');
    expect(result.length).toBe(1);
    expect(result[0].relationships.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FamilyGraph — 自动推断', () => {
  let graph: FamilyGraph;

  beforeEach(async () => {
    graph = new FamilyGraph(TEST_DB);
    await graph.initialize();
  });

  afterEach(() => {
    try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); } catch {}
  });

  it('妈妈+人名 → 自动创建 mother_of 边', async () => {
    const result = await graph.integrateFromEntity(
      [{ name: '妈妈', type: 'person', allele: '妈妈', phenotype: 'neutral', knowledge_type: 'family' }],
      '我妈妈叫李华'
    );
    expect(result.nodes_created).toBeGreaterThanOrEqual(1);
    expect(result.edges_created).toBeGreaterThanOrEqual(1);
    expect(result.details.some(d => d.includes('mother_of'))).toBe(true);
  });

  it('老公+人名 → 自动创建 spouse_of 边', async () => {
    const result = await graph.integrateFromEntity(
      [{ name: '老公', type: 'person', allele: '老公', phenotype: 'neutral', knowledge_type: 'family' }],
      '我老公叫张伟'
    );
    expect(result.edges_created).toBeGreaterThanOrEqual(1);
    expect(result.details.some(d => d.includes('spouse_of'))).toBe(true);
  });

  it('家庭成员+地点 → 自动创建 lives_in 边', async () => {
    const result = await graph.integrateFromEntity(
      [
        { name: '妈妈', type: 'person', allele: '妈妈', phenotype: 'neutral', knowledge_type: 'family' },
        { name: '深圳', type: 'place', allele: '深圳', phenotype: 'neutral', knowledge_type: 'world' },
      ],
      '我妈妈在深圳'
    );
    expect(result.details.some(d => d.includes('lives_in'))).toBe(true);
  });

  it('家庭摘要应包含成员', async () => {
    await graph.integrateFromEntity(
      [{ name: '妈妈', type: 'person', allele: '妈妈', phenotype: 'neutral', knowledge_type: 'family' }],
      '我妈妈叫李华'
    );
    const summary = await graph.getFamilySummary();
    expect(summary.members.length).toBeGreaterThanOrEqual(1);
  });
});
