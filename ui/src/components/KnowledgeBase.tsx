/**
 * KnowledgeBase — 知识库面板（3D 粒子版入口）
 *
 * 浮层面板，左侧控制台按钮触发。
 * 支持：列表浏览、关键词搜索、文件拖拽上传
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchKnowledgeList, searchKnowledge, deleteKnowledge, uploadFile, type KnowledgeItem } from '../services/knowledgeService';

export default function KnowledgeBase() {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [dragging, setDragging] = useState(false);

  /** 显示用户文档（过滤掉自动生成的 research/query/important 类型） */
  const VISIBLE_TYPES = ['text','txt','md','pdf','docx','xlsx','csv','jpg','png','person','protocol'];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchKnowledgeList(500);
      // 有搜索词时不过滤，无搜索词时只显示用户文档
      const filtered = keyword ? data : data.filter(i => VISIBLE_TYPES.includes(i.source_type));
      setItems(filtered);
    } catch { setItems([]); }
    setLoading(false);
  }, [keyword]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const handleDelete = async (id: string) => {
    await deleteKnowledge(id);
    load();
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      try {
        await uploadFile(file);
      } catch {}
    }
    load();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        await uploadFile(file);
      } catch {}
    }
    load();
    e.target.value = '';
  };

  return (
    <>
      {/* 触发按钮（左下角） */}
      <button
        className="kb-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="知识库"
        style={{
          position: 'fixed', bottom: 50, left: 12, zIndex: 100,
          width: 36, height: 36, borderRadius: 10,
          border: '1px solid rgba(0,200,180,0.15)',
          background: 'rgba(0,200,180,0.08)',
          color: '#00ffff', fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(6px)',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,200,180,0.15)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,200,180,0.08)'; }}
      >
        📚
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="kb-panel"
            initial={{ opacity: 0, x: -300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              position: 'fixed', left: 54, bottom: 50, zIndex: 99,
              width: 380, maxHeight: '60vh',
              background: 'rgba(8,10,14,0.92)',
              border: '1px solid rgba(0,200,180,0.12)',
              borderRadius: 12,
              padding: 12,
              overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            {/* 标题 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: '#00ffff', letterSpacing: 1 }}>📚 知识库</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{items.length} 项</span>
            </div>

            {/* 搜索栏 + 上传 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <input
                placeholder="搜索知识库…"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                style={{
                  flex: 1, padding: '4px 8px', borderRadius: 6,
                  border: '1px solid rgba(0,200,180,0.12)',
                  background: 'rgba(0,0,0,0.3)', color: '#c0c0c0',
                  fontSize: 10, outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <label style={{
                padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                border: '1px dashed rgba(0,200,180,0.2)',
                background: 'rgba(0,200,180,0.04)', color: '#00ffff',
                fontSize: 9, whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center',
              }}>
                📁 上传
                <input type="file" multiple style={{ display: 'none' }}
                  accept=".txt,.md,.pdf,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                />
              </label>
            </div>

            {/* 拖拽区提示 */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              style={{
                fontSize: 8, color: dragging ? '#00ffff' : 'rgba(255,255,255,0.15)',
                textAlign: 'center', padding: '3px 0', marginBottom: 6,
                border: dragging ? '1px dashed #00ffff' : '1px dashed transparent',
                borderRadius: 6, transition: 'all 0.2s',
              }}
            >
              拖入文件到此处
            </div>

            {/* 列表 */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {loading && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: 10 }}>加载中…</div>}
              {!loading && items.length === 0 && (
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 10 }}>
                  暂无内容
                </div>
              )}
              {items.map(item => (
                <div key={item.id} style={{
                  padding: '5px 8px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  fontSize: 9, lineHeight: 1.4,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{item.title}</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.04)', padding: '1px 4px', borderRadius: 3 }}>
                        {item.source_type}
                      </span>
                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{
                          background: 'none', border: 'none', color: 'rgba(255,80,80,0.5)', cursor: 'pointer',
                          fontSize: 9, padding: 0,
                        }}
                        title="删除"
                      >✕</button>
                    </div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 8, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.content.substring(0, 80)}{item.content.length > 80 ? '…' : ''}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
