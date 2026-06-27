/**
 * SettingsDock — 设置面板
 *
 * 左下角齿轮按钮 → 展开 API Key 管理面板
 * 支持新增/删除/查看已录入的 LLM API Key
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchKeys, saveKey, removeKey, type KeyEntry } from '../services/settingsService';

const KEY_PRESETS = [
  { name: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key' },
  { name: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude Key' },
  { name: 'RESEARCH_API_URL', label: '搜索 API 地址' },
  { name: 'RESEARCH_API_KEY', label: '搜索 API Key' },
];

export default function SettingsDock() {
  const [isOpen, setIsOpen] = useState(false);
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('DEEPSEEK_API_KEY');
  const [newLabel, setNewLabel] = useState('DeepSeek API Key');
  const [newValue, setNewValue] = useState('');
  const [ttsVoices, setTtsVoices] = useState<{id:string;name:string;gender:string;locale:string;engine?:string}[]>([]);
  const [ttsVoice, setTtsVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [ttsStatus, setTtsStatus] = useState('');

  const loadKeys = async () => {
    try {
      const data = await fetchKeys();
      setKeys(data);
    } catch { setKeys([]); }
  };

  useEffect(() => { if (isOpen) loadKeys(); }, [isOpen]);

  // 加载 TTS 声音列表（仅 Edge-TTS，其他引擎已移除）
  const loadVoices = async () => {
    try {
      const res = await fetch('http://localhost:8765/voices');
      if (!res.ok) { setTtsStatus('TTS 服务未连接'); return; }
      const data = await res.json();
      setTtsVoices(data.voices || []);
      setTtsVoice(data.current || 'zh-CN-XiaoxiaoNeural');
      setTtsStatus('在线');
    } catch { setTtsStatus('TTS 服务未连接'); }
  };
  useEffect(() => { if (isOpen) loadVoices(); }, [isOpen]);

  const handleVoiceChange = async (voiceId: string) => {
    setTtsVoice(voiceId);
    setTtsStatus('切换中...');
    try {
      const res = await fetch('http://localhost:8765/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceId }),
      });
      if (res.ok) setTtsStatus('已切换');
      else setTtsStatus('切换失败');
    } catch { setTtsStatus('切换失败'); }
    setTimeout(() => setTtsStatus('在线'), 2000);
  };

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSave = async () => {
    if (!newValue.trim()) { setMsg('请输入 API Key'); setTimeout(() => setMsg(''), 2000); return; }
    setSaving(true);
    try {
      const ok = await saveKey(newName, newValue.trim(), newLabel || newName);
      if (ok) {
        setMsg('✅ 已保存');
        setNewValue('');
        setAdding(false);
        loadKeys();
      } else {
        setMsg('❌ 保存失败');
      }
    } catch {
      setMsg('❌ 保存异常');
    }
    setSaving(false);
    setTimeout(() => setMsg(''), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newValue.trim()) handleSave();
  };

  const handleDelete = async (name: string) => {
    await removeKey(name);
    loadKeys();
  };

  const handlePreset = (name: string) => {
    setNewName(name);
    const preset = KEY_PRESETS.find(k => k.name === name);
    setNewLabel(preset?.label || name);
  };

  return (
    <>
      {/* 齿轮按钮 */}
      <button
        className="settings-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="设置"
        style={{
          position: 'fixed', bottom: 12, left: 12, zIndex: 100,
          width: 36, height: 36, borderRadius: 10,
          border: '1px solid rgba(180,195,210,0.12)',
          background: 'rgba(180,195,210,0.06)',
          color: 'rgba(180,195,210,0.7)', fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(6px)',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(180,195,210,0.12)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(180,195,210,0.06)'; }}
      >
        ⚙
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              position: 'fixed', left: 54, bottom: 12, zIndex: 99,
              width: 400, maxHeight: '70vh',
              background: 'rgba(10,12,16,0.94)',
              border: '1px solid rgba(180,195,210,0.1)',
              borderRadius: 12,
              padding: 14,
              overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              fontFamily: "'JetBrains Mono','Cascadia Code',monospace",
            }}
          >
            {/* 标题 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'rgba(180,195,210,0.8)', letterSpacing: 1 }}>⚙ 设置 · API Key</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>v0.1</span>
            </div>

            {/* Key 列表 */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {keys.length === 0 && (
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 12 }}>
                  暂无已录入的 API Key<br />
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.12)' }}>点「新增」添加 DeepSeek 或其他 API Key</span>
                </div>
              )}
              {keys.map(k => (
                <div key={k.name} style={{
                  padding: '6px 8px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  fontSize: 9,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: '#c0c0c0', fontWeight: 600, fontSize: 10 }}>{k.label}</div>
                      <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 8, marginTop: 2 }}>{k.value}</div>
                    </div>
                    <button
                      onClick={() => handleDelete(k.name)}
                      style={{
                        background: 'none', border: 'none', color: 'rgba(255,80,80,0.4)',
                        cursor: 'pointer', fontSize: 10, padding: '2px 4px',
                      }}
                      title="删除"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>

            {/* 新增区域 */}
            {adding ? (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <select
                    value={newName}
                    onChange={e => handlePreset(e.target.value)}
                    style={{
                      flex: 1, padding: '4px 6px', borderRadius: 6,
                      border: '1px solid rgba(180,195,210,0.12)',
                      background: 'rgba(0,0,0,0.3)', color: '#c0c0c0',
                      fontSize: 9, outline: 'none', fontFamily: 'inherit',
                    }}
                  >
                    {KEY_PRESETS.map(k => (
                      <option key={k.name} value={k.name}>{k.label}</option>
                    ))}
                    <option value="CUSTOM">自定义</option>
                  </select>
                  {newName === 'CUSTOM' && (
                    <input
                      placeholder="名称"
                      value={newLabel}
                      onChange={e => setNewLabel(e.target.value)}
                      style={{
                        width: 80, padding: '4px 6px', borderRadius: 6,
                        border: '1px solid rgba(180,195,210,0.12)',
                        background: 'rgba(0,0,0,0.3)', color: '#c0c0c0',
                        fontSize: 9, outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    placeholder="粘贴 API Key…"
                    value={newValue}
                    onChange={e => setNewValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    style={{
                      flex: 1, padding: '4px 8px', borderRadius: 6,
                      border: '1px solid rgba(180,195,210,0.12)',
                      background: 'rgba(0,0,0,0.3)', color: '#c0c0c0',
                      fontSize: 9, outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <button onClick={handleSave} disabled={saving} style={{
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid rgba(0,200,180,0.2)',
                    background: saving ? 'transparent' : 'rgba(0,200,180,0.08)',
                    color: saving ? 'rgba(255,255,255,0.2)' : '#00ffff',
                    fontSize: 9, cursor: saving ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}>{saving ? '…' : '保存'}</button>
                  <button onClick={() => setAdding(false)} style={{
                    padding: '4px 8px', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.06)',
                    background: 'transparent', color: 'rgba(255,255,255,0.3)',
                    fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
                  }}>取消</button>
                </div>
                {msg && <div style={{ fontSize: 8, color: msg.includes('✅') ? '#4ade80' : '#f87171', marginTop: 4 }}>{msg}</div>}
              </div>
            ) : (
              <button onClick={() => setAdding(true)} style={{
                width: '100%', padding: '5px 0', borderRadius: 6,
                border: '1px dashed rgba(180,195,210,0.12)',
                background: 'transparent', color: 'rgba(180,195,210,0.4)',
                fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,200,180,0.3)'; e.currentTarget.style.color = 'rgba(0,200,180,0.6)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(180,195,210,0.12)'; e.currentTarget.style.color = 'rgba(180,195,210,0.4)'; }}
              >
                + 新增 API Key
              </button>
            )}

            {/* ── TTS 语音设置（仅 Edge-TTS） ── */}
            <div style={{
              marginTop: 10, paddingTop: 8,
              borderTop: '1px solid rgba(255,255,255,0.04)',
            }}>
              <div style={{ fontSize: 9, color: 'rgba(180,195,210,0.5)', marginBottom: 6 }}>
                🎤 语音合成 · Edge-TTS
              </div>
              <div style={{ fontSize: 9, color: 'rgba(180,195,210,0.5)', marginBottom: 6 }}>
                音色
              </div>
              <select
                value={ttsVoice}
                onChange={e => handleVoiceChange(e.target.value)}
                style={{
                  width: '100%', padding: '5px 8px', borderRadius: 6,
                  border: '1px solid rgba(180,195,210,0.12)',
                  background: 'rgba(0,0,0,0.3)', color: '#c0c0c0',
                  fontSize: 9, outline: 'none', fontFamily: 'inherit',
                }}
              >
                {ttsVoices.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.gender} · {v.locale})
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 8, color: ttsStatus === '在线' ? '#4ade80' : '#f87171', marginTop: 4 }}>
                {ttsStatus}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
