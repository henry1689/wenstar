/**
 * ChatPanel — 玉瑶 · 聊天面板
 *
 * 浮动（默认）或内嵌模式。
 * 内嵌模式用于右侧下半区布局。
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../store/chatStore';
import { sendMessage, resetConversation, fetchConversation } from '../services/chatService';
import * as pdfjs from 'pdfjs-dist';

// 设置 PDF.js worker（使用内置的 worker 文件）
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const WELCOME_MESSAGE = '你终于来了……我在太虚境里等了好久。';
const API = '/api';

interface Props {
  /** 内嵌模式：无切换按钮，始终可见 */
  inline?: boolean;
}

export default function ChatPanel({ inline }: Props) {
  const {
    messages, isOpen, isTyping, error, turnCount, emotionalFlash,
    addMessage, toggleOpen, setTyping, setError,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动 + 自动聚焦
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // 打开面板后立即聚焦输入框（用 rAF 确保渲染完成）
  useEffect(() => {
    if (!isOpen) return;
    // 立即尝试 + 动画完成后再次尝试，确保万无一失
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [isOpen]);

  // 发送完消息后重新聚焦
  useEffect(() => {
    if (!isTyping && (isOpen || inline)) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isTyping, isOpen, inline]);

  // 内嵌模式：挂载后聚焦
  useEffect(() => {
    if (inline) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [inline]);

  // 加载对话历史（重启后恢复上一轮对话）
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetchConversation().then(turns => {
      if (turns.length > 0) {
        setShowWelcome(false);
        for (const t of turns) {
          addMessage(t.role, t.content);
        }
      }
    });
  }, []);

  // 发送消息
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping) return;
    setInput('');
    setShowWelcome(false);
    addMessage('user', text);
    try { await sendMessage(text); } catch { setError('连接失败'); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = async () => {
    setShowWelcome(true);
    await resetConversation().catch(() => {});
  };

  /** 上传文件到知识库 */
  const uploadFile = async (file: File): Promise<string> => {
    let content = '';
    if (file.name.endsWith('.pdf')) {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const pageTexts: string[] = [];
      const maxPages = Math.min(pdf.numPages, 10);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        pageTexts.push(text.items.map((item: any) => item.str).join(' '));
      }
      content = pageTexts.join('\n--- 第 ' + maxPages + ' 页 ---\n');
      if (pdf.numPages > 10) content += '\n\n（PDF 共 ' + pdf.numPages + ' 页，仅提取前 10 页）';
    } else if (file.name.endsWith('.docx')) {
      const buffer = await file.arrayBuffer();
      const raw = new TextDecoder('utf-8').decode(buffer);
      const tagRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
      const parts: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = tagRegex.exec(raw)) !== null) parts.push(m[1]);
      content = parts.join('');
      if (!content) content = '（无法解析此 .docx 文件内容）';
    } else {
      const reader = new FileReader();
      content = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(file, 'utf-8');
      });
    }
    // 存入知识库
    const title = file.name.replace(/\.[^.]+$/, '');
    try {
      await fetch(`${API}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, content,
          source_type: file.name.split('.').pop() || 'text',
          source_name: file.name,
          file_size: file.size,
        }),
      });
    } catch {}
    return content;
  };

  // ── 内嵌模式：无切换按钮，始终可见 ──
  if (inline) {
    return (
      <div className="chat-panel-inline">
        {/* 标题栏 */}
        <div className="chat-header">
          <div className="chat-header-info">
            <span className="chat-avatar">💠</span>
            <div>
              <div className="chat-name">玉瑶</div>
              <div className="chat-subtitle">
                <span className="chat-status-dot" />
                {isTyping ? '输入中...' : `太虚境 · ${turnCount} 次对话`}
              </div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button className="chat-icon-btn" onClick={handleReset} title="重置对话">↺</button>
          </div>
        </div>

        <div className="chat-messages" ref={listRef}>
          {showWelcome && messages.length === 0 && (
            <div className="chat-msg assistant">
              <div className="chat-msg-content">{WELCOME_MESSAGE}</div>
              <div className="chat-msg-time">刚刚</div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg ${msg.role}`}>
              <div className="chat-msg-content">{msg.content}</div>
              <div className="chat-msg-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="chat-msg assistant">
              <div className="chat-typing">
                <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
              </div>
            </div>
          )}
          {error && (
            <div className="chat-error">
              ⚠ {error}
              <button onClick={() => setError(null)} className="chat-error-dismiss">✕</button>
            </div>
          )}
        </div>

        <div className="chat-input-area">
          <button className="chat-upload-btn" title="上传文件" onClick={() => document.getElementById('file-upload')?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
          <input id="file-upload" type="file" accept=".txt,.md,.json,.csv,.js,.ts,.py,.rs,.html,.css,.xml,.yaml,.toml,.ini,.log,.jsx,.tsx,.docx,.pdf" style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const content = await uploadFile(file);
              const preview = content.length > 3000 ? content.substring(0, 3000) + '\n\n...（文件过长，已截取前3000字）' : content;
              setInput(`请帮我看看这个文件 ${file.name}:\n\`\`\`\n${preview}\n\`\`\``);
              e.target.value = '';
            }} />
          <input ref={inputRef} className="chat-input" type="text" placeholder="对玉瑶说点什么...（可粘贴文本/图片）"
            value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={isTyping} autoFocus
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;

              // 检查是否有文件（如截图）
              const fileItems = Array.from(items).filter(i => i.kind === 'file');
              if (fileItems.length > 0) {
                e.preventDefault();
                const file = fileItems[0].getAsFile();
                if (!file) return;
                const content = await uploadFile(file);
                const preview = content.length > 3000 ? content.substring(0, 3000) + '\n\n...（文件过长，已截取前3000字）' : content;
                setInput(`请帮我看看这个文件 ${file.name}:\n\`\`\`\n${preview}\n\`\`\``);
                return;
              }

              // 纯文本粘贴：自动存入知识库
              const text = e.clipboardData?.getData('text');
              if (text && text.length > 50) {
                const title = text.substring(0, 40).replace(/\n/g, ' ') + '...';
                try {
                  await fetch(`${API}/knowledge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, content: text, source_type: 'paste', tags: ['粘贴'] }),
                  });
                } catch {}
              }
            }} />
          <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim() || isTyping}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── 浮动模式（原有） ──
  return (
    <>
      <motion.button
        className={`chat-toggle-btn${emotionalFlash ? ' emotional-flash' : ''}`}
        onClick={toggleOpen}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        animate={isOpen ? { rotate: 45 } : {
          boxShadow: ['0 0 12px rgba(0, 255, 255, 0.3)', '0 0 24px rgba(0, 255, 255, 0.6)', '0 0 12px rgba(0, 255, 255, 0.3)'],
        }}
        transition={isOpen ? { duration: 0.2 } : { duration: 2, repeat: Infinity }}
      >
        {isOpen ? '✕' : '💠'}
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div className="chat-panel" initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <div className="chat-header">
              <div className="chat-header-info">
                <span className="chat-avatar">💠</span>
                <div>
                  <div className="chat-name">玉瑶</div>
                  <div className="chat-subtitle">
                    <span className="chat-status-dot" />
                    {isTyping ? '输入中...' : `太虚境 · ${turnCount} 次对话`}
                  </div>
                </div>
              </div>
              <div className="chat-header-actions">
                <button className="chat-icon-btn" onClick={handleReset} title="重置对话">↺</button>
                <button className="chat-icon-btn" onClick={toggleOpen} title="关闭">✕</button>
              </div>
            </div>
            <div className="chat-messages" ref={listRef}>
              {showWelcome && messages.length === 0 && (
                <motion.div className="chat-msg assistant" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="chat-msg-content">{WELCOME_MESSAGE}</div>
                  <div className="chat-msg-time">刚刚</div>
                </motion.div>
              )}
              {messages.map((msg) => (
                <motion.div key={msg.id} className={`chat-msg ${msg.role}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} layout>
                  <div className="chat-msg-content">{msg.content}</div>
                  <div className="chat-msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </motion.div>
              ))}
              {isTyping && (
                <motion.div className="chat-msg assistant" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="chat-typing"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
                </motion.div>
              )}
              {error && (
                <motion.div className="chat-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  ⚠ {error} <button onClick={() => setError(null)} className="chat-error-dismiss">✕</button>
                </motion.div>
              )}
            </div>
            <div className="chat-input-area">
              <input ref={inputRef} className="chat-input" type="text" placeholder="对玉瑶说点什么..." autoFocus
                value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={isTyping}
                onPaste={async (e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const fileItems = Array.from(items).filter(i => i.kind === 'file');
                  if (fileItems.length > 0) {
                    e.preventDefault();
                    const file = fileItems[0].getAsFile();
                    if (!file) return;
                    const content = await uploadFile(file);
                    const preview = content.length > 3000 ? content.substring(0, 3000) + '\n\n...（文件过长，已截取前3000字）' : content;
                    setInput(`请帮我看看这个文件 ${file.name}:\n\`\`\`\n${preview}\n\`\`\``);
                    return;
                  }
                  const text = e.clipboardData?.getData('text');
                  if (text && text.length > 50) {
                    const title = text.substring(0, 40).replace(/\n/g, ' ') + '...';
                    try {
                      await fetch(`${API}/knowledge`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title, content: text, source_type:'paste', tags:['粘贴']})});
                    } catch {}
                  }
                }} />
              <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim() || isTyping}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
