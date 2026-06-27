/**
 * KnowledgePanel — 知识库文件管理器
 *
 * 列表 / 查看内容 / 新增 / 删除
 * 以模态覆盖层形式浮在聊天面板上方。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  fetchKnowledgeList, fetchKnowledgeItem, addKnowledge, deleteKnowledge,
  type KnowledgeItem,
} from '../services/knowledgeService';

type View = 'list' | 'view' | 'add';

export default function KnowledgePanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [view, setView] = useState<View>('list');
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新增表单
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newClass, setNewClass] = useState('');

  const load = useCallback(async (retries = 3) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchKnowledgeList(100);
      setItems(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      // 502 = 后端临时不可用，自动重试（指数退避）
      if (msg.includes('502') && retries > 0) {
        const wait = (4 - retries) * 2000;
        await new Promise(r => setTimeout(r, wait));
        return load(retries - 1);
      }
      setError('加载失败: ' + msg);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleView = async (id: string) => {
    setLoading(true);
    setError(null);
    const item = await fetchKnowledgeItem(id);
    if (item) {
      setSelected(item);
      setView('view');
    } else {
      setError('无法加载条目');
    }
    setLoading(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`确定删除「${title.substring(0, 30)}」吗？`)) return;
    const ok = await deleteKnowledge(id);
    if (ok) {
      setItems(prev => prev.filter(i => i.id !== id));
      if (selected?.id === id) { setSelected(null); setView('list'); }
    } else {
      setError('删除失败');
    }
  };

  const handleAdd = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    const entry = await addKnowledge({
      title: newTitle.trim(),
      content: newContent.trim(),
      classification: newClass.trim() || undefined,
    });
    if (entry) {
      setItems(prev => [entry, ...prev]);
      setNewTitle('');
      setNewContent('');
      setNewClass('');
      setView('list');
    } else {
      setError('新增失败');
    }
  };

  const classify = (cls: string | undefined) => cls || '未分类';

  return (
    <div className="kb-overlay" onClick={onClose}>
      <div className="kb-panel" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="kb-header">
          <span className="kb-title">📚 知识库 <span className="kb-count">({items.length})</span></span>
          <div className="kb-header-actions">
            {view === 'list' && (
              <>
                <button className="kb-btn" onClick={load} title="刷新列表">↻</button>
                <button className="kb-btn kb-btn-add" onClick={() => { setNewTitle(''); setNewContent(''); setNewClass(''); setView('add'); }}>＋ 新增</button>
              </>
            )}
            <button className="kb-btn kb-btn-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {error && (
          <div className="kb-error">
            ⚠ {error}
            <button onClick={() => { setError(null); load(); }} className="kb-btn" style={{fontSize:10,marginLeft:8}}>重试</button>
            <button onClick={() => setError(null)} className="kb-error-dismiss">✕</button>
          </div>
        )}

        <div className="kb-body">
          {/* ── 列表视图 ── */}
          {view === 'list' && (
            <div className="kb-list">
              {loading ? (
                <div className="kb-loading">加载中...</div>
              ) : items.length === 0 ? (
                <div className="kb-empty">知识库为空</div>
              ) : (
                items.map(item => (
                  <div key={item.id} className="kb-item">
                    <div className="kb-item-main" onClick={() => handleView(item.id)}>
                      <div className="kb-item-title">{item.title || '(无标题)'}</div>
                      <div className="kb-item-meta">
                        <span className="kb-item-class">{classify(item.classification)}</span>
                        <span className="kb-item-time">{new Date(item.created_at).toLocaleDateString()}</span>
                        {item.source_type !== 'text' && <span className="kb-item-src">{item.source_type}</span>}
                      </div>
                    </div>
                    <button className="kb-item-del" onClick={() => handleDelete(item.id, item.title)} title="删除">🗑</button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── 内容视图 ── */}
          {view === 'view' && selected && (
            <div className="kb-view">
              <button className="kb-back" onClick={() => { setSelected(null); setView('list'); }}>← 返回</button>
              <div className="kb-view-title">{selected.title}</div>
              <div className="kb-view-meta">
                <span>分类: {classify(selected.classification)}</span>
                <span>类型: {selected.source_type}</span>
                <span>创建: {new Date(selected.created_at).toLocaleString()}</span>
              </div>
              <div className="kb-view-content">{selected.content}</div>
            </div>
          )}

          {/* ── 新增视图 ── */}
          {view === 'add' && (
            <div className="kb-add">
              <button className="kb-back" onClick={() => setView('list')}>← 返回</button>
              <div className="kb-add-title">新增知识条目</div>
              <div className="kb-add-field">
                <label>标题</label>
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="输入标题..." className="kb-add-input" />
              </div>
              <div className="kb-add-field">
                <label>分类（可选）</label>
                <input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="如: 知识科普、文档资料、个人档案..." className="kb-add-input" />
              </div>
              <div className="kb-add-field">
                <label>内容</label>
                <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="输入内容..." className="kb-add-textarea" rows={12} />
              </div>
              <button className="kb-btn kb-btn-add" onClick={handleAdd} disabled={!newTitle.trim() || !newContent.trim()}>保存</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
