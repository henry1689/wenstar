/**
 * KnowledgeService — 知识库 API 客户端
 */
const API_BASE = '/api';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source_type: string;
  source_name: string | null;
  file_size: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  locked: boolean;
}

/** 获取知识库列表 */
export async function fetchKnowledgeList(limit = 100): Promise<KnowledgeItem[]> {
  const res = await fetch(`${API_BASE}/knowledge?limit=${limit}`);
  if (!res.ok) throw new Error(`Knowledge list error: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

/** 搜索知识库 */
export async function searchKnowledge(keyword: string): Promise<KnowledgeItem[]> {
  const res = await fetch(`${API_BASE}/knowledge?search=${encodeURIComponent(keyword)}&limit=50`);
  if (!res.ok) throw new Error(`Knowledge search error: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

/** 获取单条知识详情 */
export async function fetchKnowledgeItem(id: string): Promise<KnowledgeItem | null> {
  try {
    const res = await fetch(`${API_BASE}/knowledge/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** 新增知识条目 */
export async function addKnowledge(params: {
  title: string; content: string; source_type?: string;
  tags?: string[]; classification?: string;
}): Promise<KnowledgeItem | null> {
  try {
    const res = await fetch(`${API_BASE}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** 更新知识条目 */
export async function updateKnowledge(id: string, params: {
  title?: string; content?: string; tags?: string[];
}): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/knowledge/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.ok;
  } catch { return false; }
}

/** 删除知识条目 */
export async function deleteKnowledge(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/knowledge`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return res.ok;
}

/** 上传文件到知识库 */
export async function uploadFile(file: File): Promise<KnowledgeItem> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/knowledge/upload`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'upload failed' }));
    throw new Error(err.error || 'upload failed');
  }
  return res.json();
}
