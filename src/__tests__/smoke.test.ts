/**
 * 文曲星·玉瑶 全面测试套件
 *
 * 覆盖：
 *   1. API 端点冒烟测试（所有公开端点）
 *   2. 核心链路 E2E 测试（聊天 + 知识库 + 角色切换）
 *   3. 数据完整性测试（写入→读取校验）
 *
 * 运行：npx vitest run src/__tests__/smoke.test.ts
 * 前提：服务器运行在 localhost:3000
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost:3000';

// ─── 辅助函数 ───

async function api(path: string, options?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
}

async function json(path: string, options?: RequestInit): Promise<any> {
  const res = await api(path, options);
  const body = await res.text();
  try { return { status: res.status, data: JSON.parse(body) }; }
  catch { return { status: res.status, data: body }; }
}

// ─── 1. API 端点冒烟测试 ───

describe('P3.1 - API 端点冒烟测试', () => {
  it('首页 HTML 返回 200', async () => {
    const res = await api('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('玉瑶');
  });

  it('GET /api/status 返回系统状态', async () => {
    const { status, data } = await json('/api/status');
    expect(status).toBe(200);
    expect(data.status).toBe('running');
    expect(typeof data.conversation_turns).toBe('number');
  });

  it('GET /api/health 返回健康指标', async () => {
    const { status } = await json('/api/health');
    expect(status).toBe(200);
  });

  it('GET /api/modules 返回 M6-M8 数据', async () => {
    const { status, data } = await json('/api/modules');
    expect(status).toBe(200);
    expect(data.m6).toBeDefined();
    expect(data.m6.traits).toBeDefined();
    expect(data.m7).toBeDefined();
    expect(data.m8).toBeDefined();
  });

  it('GET /api/knowledge 返回知识库列表', async () => {
    const { status, data } = await json('/api/knowledge');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe('number');
  });

  it('GET /api/knowledge?search=xxx 支持关键词搜索', async () => {
    const { status, data } = await json('/api/knowledge?search=测试');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('GET /api/personas 返回所有角色', async () => {
    const { status, data } = await json('/api/personas');
    expect(status).toBe(200);
    expect(Array.isArray(data.list)).toBe(true);
    expect(data.list.length).toBeGreaterThanOrEqual(2);
    expect(data.active).toBeDefined();
  });

  it('GET /api/relations 返回实体关系图', async () => {
    const { status } = await json('/api/relations');
    expect(status).toBe(200);
  });

  it('GET /api/landscape 返回情感地形', async () => {
    const { status } = await json('/api/landscape');
    expect(status).toBe(200);
  });
});

// ─── 2. 核心链路 E2E 测试 ───

describe('P3.2 - 核心链路 E2E 测试', () => {
  it('聊天正常返回 M1-M5 全链路数据', async () => {
    const { status, data } = await json('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '你好' }),
    });
    expect(status).toBe(200);
    expect(typeof data.reply).toBe('string');
    expect(data.reply.length).toBeGreaterThan(0);
    // M1
    expect(data.m1.branch_id).toBeTruthy();
    expect(data.m1.locus_path).toBeTruthy();
    // M3
    expect(data.m3.calcium).toBeDefined();
    expect(typeof data.m3.calcium.score).toBe('number');
    // M4
    expect(Array.isArray(data.m4.timeline)).toBe(true);
    // M5
    expect(data.m5.strategy_id).toBeTruthy();
  });

  it('知识库 CRUD 完整链路', async () => {
    // 创建
    const { status: s1, data: d1 } = await json('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify({ title: '测试条目', content: '这是测试内容' }),
    });
    expect(s1).toBe(201);
    expect(d1.id).toBeTruthy();
    const id = d1.id;

    // 读取
    const { status: s2, data: d2 } = await json('/api/knowledge');
    expect(s2).toBe(200);
    expect(d2.items.some((i: any) => i.id === id)).toBe(true);

    // 更新
    const { status: s3 } = await json(`/api/knowledge/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: '更新测试', content: '更新后的内容' }),
    });
    expect(s3).toBe(200);

    // 搜索
    const { status: s4, data: d4 } = await json('/api/knowledge?search=更新测试');
    expect(s4).toBe(200);
    expect(d4.items.length).toBeGreaterThanOrEqual(1);

    // 删除
    const { status: s5 } = await json('/api/knowledge', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
    expect(s5).toBe(200);
  });

  it('角色切换工作正常', async () => {
    // 获取角色列表
    const { data: d1 } = await json('/api/personas');
    const firstRole = d1.active;

    // 切换到秘书
    const { status: s2 } = await json('/api/personas', {
      method: 'POST',
      body: JSON.stringify({ persona: 'secretary' }),
    });
    expect(s2).toBe(200);

    // 验证已切换
    const { data: d3 } = await json('/api/personas');
    expect(d3.active).toBe('secretary');

    // 聊天（秘书模式下）
    const { status: s4 } = await json('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '帮我记个事' }),
    });
    expect(s4).toBe(200);

    // 切回原角色
    await json('/api/personas', {
      method: 'POST',
      body: JSON.stringify({ persona: firstRole }),
    });
  });

  it('秘书工具执行正常', async () => {
    const { status, data } = await json('/api/secretary', {
      method: 'POST',
      body: JSON.stringify({ message: '记录：测试笔记' }),
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary).toBeTruthy();
    expect(Array.isArray(data.details)).toBe(true);
  });

  it('文件上传失败返回合理错误（空文件）', async () => {
    // 没有文件直接 POST 应该返回 400
    const res = await api('/api/knowledge/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----test' },
      body: '--test--',
    });
    expect(res.status).toBe(400);
  });
});

// ─── 3. 数据完整性测试 ───

describe('P3.3 - 数据完整性测试', () => {
  it('知识库写入→读取内容一致', async () => {
    const content = `测试数据完整性 ${Date.now()}`;
    const { data: d1 } = await json('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify({ title: '完整性测试', content }),
    });
    expect(d1.content).toBe(content);

    // 通过搜索验证
    const { data: d2 } = await json(`/api/knowledge?search=完整性测试`);
    const found = d2.items.find((i: any) => i.id === d1.id);
    expect(found).toBeDefined();
    expect(found!.content).toBe(content);

    // 清理
    await json('/api/knowledge', { method: 'DELETE', body: JSON.stringify({ id: d1.id }) });
  });

  it('对话返回的数据格式稳定', async () => {
    const messages = ['你好', '今天天气真好', '帮我记住这个：测试'];
    for (const msg of messages) {
      const { status, data } = await json('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      expect(status).toBe(200);
      // 关键字段都存在
      expect(data.reply).toBeTruthy();
      expect(data.m1.branch_id).toBeTruthy();
      expect(data.m3.calcium).toBeTruthy();
      expect(typeof data.m3.calcium.score).toBe('number');
      expect(data.m5.strategy_id).toBeTruthy();
      // emotionalFlash 是布尔值
      expect(typeof data.emotionalFlash).toBe('boolean');
    }
  });

  it('知识库搜索一致性（相同关键词多次搜索返回一致）', async () => {
    const keyword = '测试';
    const r1 = await json(`/api/knowledge?search=${keyword}`);
    const r2 = await json(`/api/knowledge?search=${keyword}`);
    expect(r1.data.total).toBe(r2.data.total);
  });

  it('角色列表不会因切换而改变', async () => {
    const { data: d1 } = await json('/api/personas');
    const countBefore = d1.list.length;

    await json('/api/personas', { method: 'POST', body: JSON.stringify({ persona: 'mentor' }) });
    const { data: d2 } = await json('/api/personas');
    expect(d2.list.length).toBe(countBefore);

    await json('/api/personas', { method: 'POST', body: JSON.stringify({ persona: 'yuyao' }) });
  });
});
