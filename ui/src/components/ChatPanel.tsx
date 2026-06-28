/**
 * ChatPanel — 玉瑶 · 聊天面板
 *
 * 浮动（默认）或内嵌模式。
 * 内嵌模式用于右侧下半区布局。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../store/chatStore';
import { sendMessage, resetConversation, fetchConversation, setOnTTSAudioState, unlockAudio, stopTTS, isTTSPlaying, recallMessage } from '../services/chatService';
import KnowledgePanel from './KnowledgePanel';
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
  const [voiceMode, setVoiceMode] = useState<'none' | 'mic' | 'phone'>('none');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [showKB, setShowKB] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const voiceModeRef = useRef<'none' | 'mic' | 'phone'>('none');
  const phoneTimerRef = useRef<any>(null);
  const phoneBufferRef = useRef('');
  const inputTimerRef = useRef<any>(null);
  const isKeyboardPhone = useRef(false);
  // 键盘电话模式：输入内容后5秒自动发送
  const triggerInputAutoSend = useCallback((text: string) => {
    if (!text.trim()) return;
    if (useChatStore.getState().isTyping) return;
    setShowWelcome(false);
    addMessage('user', text.trim());
    setInput('');
    sendMessage(text.trim(), ttsEnabled).catch(() => {});
  }, [ttsEnabled, addMessage]);

  // TTS 音频状态监听（不再需要暂停识别器，保留为空函数防止报错）
  useEffect(() => {
    setOnTTSAudioState(() => {});
    return () => setOnTTSAudioState(null);
  }, []);

  // SSE 提醒事件监听
  useEffect(() => {
    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource('/events');
      evtSource.addEventListener('reminder', (e: any) => {
        try {
          const data = JSON.parse(e.data);
          if (data.text) setNotice('⏰ ' + data.text);
        } catch {}
      });
    } catch {}
    return () => { evtSource?.close(); };
  }, []);

  // ── 麦克风模式：语音转文字填入输入框 ──
  const toggleMic = useCallback(() => {
    unlockAudio();
    if (voiceModeRef.current === 'mic') {
      recognitionRef.current?.stop();
      voiceModeRef.current = 'none';
      setVoiceMode('none');
      return;
    }
    if (voiceModeRef.current === 'phone') {
      if (phoneTimerRef.current) { clearTimeout(phoneTimerRef.current); phoneTimerRef.current = null; }
      recognitionRef.current?.stop();
      voiceModeRef.current = 'none';
      setVoiceMode('none');
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('手机请直接用键盘上的🎤麦克风按钮说话'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text && text.length >= 2) {
            setInput(prev => (prev ? prev + ' ' + text : text));
          }
        }
      }
    };
    recognition.onerror = (err: any) => { console.warn('[Mic] Error:', err?.error || err); };
    recognition.onend = () => {
      if (voiceModeRef.current === 'mic') { setTimeout(() => { try { recognition.start(); } catch {} }, 300); }
      else { setVoiceMode('none'); }
    };
    recognition.start();
    voiceModeRef.current = 'mic';
    setVoiceMode('mic');
  }, [setError]);

  // ── 电话模式：精简可靠 ──
  const recGenRef = useRef(0);
  const _sendingRef = useRef(false);

  const startRecognition = useCallback(() => {
    const _SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!_SR || voiceModeRef.current !== 'phone') return;
    const gen = ++recGenRef.current;

    const r = new _SR();
    r.lang = 'zh-CN';
    r.interimResults = false;
    r.continuous = false;                    // iOS 不支持 continuous:true
    recognitionRef.current = r;

    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const t = e.results[i][0].transcript.trim();
        if (t.length < 2) continue;
        if (isTTSPlaying()) { stopTTS(); return; }
        _sendingRef.current = true;
        setShowWelcome(false);
        addMessage('user', t);
        sendMessage(t, ttsEnabled).catch(() => {}).finally(() => {
          _sendingRef.current = false;
        });
        return;
      }
    };

    r.onend = () => {
      if (gen !== recGenRef.current || voiceModeRef.current !== 'phone') return;
      // 轮询等待：直到消息发送完毕 && TTS播完，再重启识别器
      const waitAndRestart = () => {
        if (gen !== recGenRef.current || voiceModeRef.current !== 'phone') return;
        if (_sendingRef.current || isTTSPlaying()) {
          return setTimeout(waitAndRestart, 300);
        }
        // TTS播完 + 500ms 确保iOS音频通道释放
        setTimeout(() => startRecognition(), 500);
      };
      waitAndRestart();
    };

    r.onerror = () => {
      if (gen === recGenRef.current && voiceModeRef.current === 'phone') {
        setTimeout(() => startRecognition(), 1000);
      }
    };

    try { r.start(); } catch {
      if (gen === recGenRef.current) setTimeout(() => startRecognition(), 1000);
    }
  }, [ttsEnabled, addMessage]);

  const flushPhone = useCallback(() => {
    if (phoneBufferRef.current) {
      const text = phoneBufferRef.current;
      phoneBufferRef.current = '';
      setShowWelcome(false);
      addMessage('user', text);
      sendMessage(text, ttsEnabled).catch(() => {});
    }
  }, [ttsEnabled, addMessage]);

  /** 用户选择候选回复（记录偏好到 M6） */
  const handleCandidateSelect = useCallback(async (msgId: string, chosen: 'a' | 'b', candidates: any) => {
    const chosenCand = chosen === 'a' ? candidates.a : candidates.b;
    const store = useChatStore.getState();
    // 更新消息内容为用户选择的版本
    const updated = store.messages.map(m =>
      m.id === msgId ? { ...m, content: chosenCand.text, candidates: null } : m
    );
    store.setLastMessageCandidates(null);
    // 重新设置 messages
    useChatStore.setState({ messages: updated });
    // 记录偏好到后端
    try {
      const tags: string[] = [];
      if (candidates.a.strategy) tags.push('tone:' + chosenCand.strategy.tone);
      if (candidates.a.strategy) tags.push('depth:' + chosenCand.strategy.depth);
      await fetch('/api/chat/prefer-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chosen, tags }),
      });
    } catch {}
  }, []);

  /** 30秒内撤回已发送消息 */
  const handleRecall = useCallback(async (msgId: string) => {
    const ok = await recallMessage(msgId);
    if (ok) {
      useChatStore.getState().recallMessage(msgId);
    }
  }, []);

  const togglePhone = useCallback(() => {
    unlockAudio();
    if (voiceModeRef.current === 'phone') {
      voiceModeRef.current = 'none';
      setVoiceMode('none');
      if (phoneTimerRef.current) { clearTimeout(phoneTimerRef.current); phoneTimerRef.current = null; }
      if (inputTimerRef.current) { clearTimeout(inputTimerRef.current); inputTimerRef.current = null; }
      flushPhone();
      isKeyboardPhone.current = false;
      try { recognitionRef.current?.stop(); } catch {}
      return;
    }
    if (voiceModeRef.current === 'mic') {
      recognitionRef.current?.stop();
      voiceModeRef.current = 'none';
      setVoiceMode('none');
    }
    const _SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    voiceModeRef.current = 'phone';
    setVoiceMode('phone');
    if (_SR) {
      navigator.mediaDevices.getUserMedia({audio:true}).then(s => s.getTracks().forEach(t => t.stop())).catch(()=>{});
      phoneBufferRef.current = '';
      _sendingRef.current = false;
      setTimeout(() => startRecognition(), 100);
    } else { isKeyboardPhone.current = true; setTimeout(() => inputRef.current?.focus(), 100); }
  }, [ttsEnabled, addMessage, setError]);

  const handleInputChange = (value: string) => {
    setInput(value);
    if (isKeyboardPhone.current && value.trim()) {
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      inputTimerRef.current = setTimeout(() => {
        if (isKeyboardPhone.current && voiceModeRef.current === 'phone') {
          triggerInputAutoSend(value);
        }
      }, 5000);
    }
  };

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
    if (!text || isTyping || isTTSPlaying()) return;
    setInput('');
    setShowWelcome(false);
    addMessage('user', text);
    try { await sendMessage(text, ttsEnabled); } catch { setError('连接失败'); }
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
      const res = await fetch(`${API}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, content,
          source_type: file.name.split('.').pop() || 'text',
          source_name: file.name,
          file_size: file.size,
          classification: '文档资料',
        }),
      });
      if (res.ok) {
        setNotice('✅ 已上传到知识库: ' + title.substring(0, 30));
      } else {
        const errData = await res.json().catch(() => ({}));
        setNotice('❌ 上传失败: ' + ((errData as any).error || '服务器错误'));
      }
    } catch (err) {
      setNotice('❌ 上传失败: 网络错误');
    }
    setTimeout(() => setNotice(null), 4000);
    return content;
  };

  // ── 内嵌模式：无切换按钮，始终可见 ──
  if (inline) {
    return (
      <>
      <div className="chat-panel-inline">
        {/* 标题栏 — 两行布局 */}
        <div className="chat-header">
          <div className="chat-header-top">
            <div className="chat-header-info">
              <span className="chat-avatar">💠</span>
              <div>
                <div className="chat-name">玉瑶</div>
                <div className="chat-subtitle">
                  <span className="chat-status-dot" />
                  {voiceMode === 'phone' ? '📞 通话中...' : (voiceMode === 'mic' ? '🎤 语音输入中...' : (isTyping ? '输入中...' : `太虚境 · ${turnCount} 次对话`))}
                </div>
              </div>
            </div>
          </div>
          <div className="chat-header-actions">
            <button className="chat-icon-btn" onClick={() => setTtsEnabled(!ttsEnabled)} title={ttsEnabled ? 'TTS 语音已开启' : 'TTS 语音已关闭'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ttsEnabled ? (
                  <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
                ) : (
                  <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                )}
              </svg>
            </button>
            <button className="chat-icon-btn" onClick={() => setShowKB(true)} title="知识库">📚</button>
            <button className="chat-icon-btn" onClick={async () => {
              await fetch('/api/chat/purge-test', {method:'POST'});
              useChatStore.getState().clearMessages();
              setShowWelcome(true);
              const turns = await fetchConversation();
              if (turns.length > 0) {
                setShowWelcome(false);
                for (const t of turns) {
                  useChatStore.getState().addMessage(t.role, t.content);
                }
              }
            }} title="清除测试对话">🧹</button>
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
            <div key={msg.id} className={`chat-msg ${msg.role}${msg.recalled ? ' recalled' : ''}`}>
              <div className="chat-msg-content">{msg.recalled ? '⚠ 消息已撤回' : msg.content}</div>
              <div className="chat-msg-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {msg.role === 'user' && !msg.recalled && (Date.now() - msg.timestamp < 30000) && (
                  <button className="chat-recall-btn" onClick={() => handleRecall(msg.id)} title="撤回消息">撤回</button>
                )}
              </div>
              {msg.role === 'assistant' && (msg as any).candidates && (
                <div className="chat-candidates">
                  <button className="chat-candidate-btn" onClick={() => handleCandidateSelect(msg.id, 'a', (msg as any).candidates)}
                    title="试试这个风格">
                    {(msg as any).candidates.a.label}
                  </button>
                  <button className="chat-candidate-btn" onClick={() => handleCandidateSelect(msg.id, 'b', (msg as any).candidates)}
                    title="试试这个长度">
                    {(msg as any).candidates.b.label}
                  </button>
                </div>
              )}
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
          {notice && (
            <div className="chat-notice">
              {notice}
            </div>
          )}
        </div>

        <div className="chat-input-area">
          <input id="file-upload" type="file" accept=".txt,.md,.json,.csv,.js,.ts,.py,.rs,.html,.css,.xml,.yaml,.toml,.ini,.log,.jsx,.tsx,.docx,.pdf" style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const content = await uploadFile(file);
              const preview = content.length > 3000 ? content.substring(0, 3000) + '\n\n...（文件过长，已截取前3000字）' : content;
              setInput(`请帮我看看这个文件 ${file.name}:\n\`\`\`\n${preview}\n\`\`\``);
              e.target.value = '';
            }} />
          <textarea ref={inputRef} className="chat-input" placeholder="对玉瑶说点什么...（可粘贴文本/图片）"
            value={input} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={handleKeyDown} disabled={isTyping} autoFocus
            rows={1}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
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
          <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim() || isTyping || isTTSPlaying()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
        <div className="chat-utility-bar">
          <button className="chat-upload-btn" title="上传文件" onClick={() => document.getElementById('file-upload')?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          </button>
          <button className={`chat-mic-btn${voiceMode === 'mic' ? ' recording' : ''}`} title={voiceMode === 'mic' ? '点击停止语音输入' : '语音输入'} onClick={toggleMic}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </button>
          <button className={`chat-phone-btn${voiceMode === 'phone' ? ' active' : ''}`} title={voiceMode === 'phone' ? '点击挂断' : '电话通话'} onClick={togglePhone}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {voiceMode === 'phone' ? <><line x1="22" y1="2" x2="2" y2="22" /><path d="M16 8a5 5 0 0 1 0 8" /><path d="M8 16a5 5 0 0 1 0-8" /></> : <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></>}
            </svg>
          </button>
          <button className={`chat-tts-btn${ttsEnabled ? '' : ' muted'}`} onClick={() => setTtsEnabled(!ttsEnabled)} title={ttsEnabled ? 'TTS 语音已开启' : 'TTS 语音已关闭'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {ttsEnabled ? (
                <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
              ) : (
                <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
              )}
            </svg>
          </button>
          <button className={`chat-tts-btn`} onClick={() => setShowKB(true)} title="知识库管理">📚</button>
          <button className="chat-refresh-btn" title="刷新页面" onClick={() => location.reload()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          </button>
        </div>
      </div>
      {showKB && <KnowledgePanel onClose={() => setShowKB(false)} />}
      </>
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
              <div className="chat-header-top">
                <div className="chat-header-info">
                  <span className="chat-avatar">💠</span>
                  <div>
                    <div className="chat-name">玉瑶</div>
                    <div className="chat-subtitle">
                      <span className="chat-status-dot" />
                      {voiceMode === 'phone' ? '📞 通话中...' : (voiceMode === 'mic' ? '🎤 语音输入中...' : (isTyping ? '输入中...' : `太虚境 · ${turnCount} 次对话`))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="chat-header-actions">
                <button className="chat-icon-btn" onClick={() => setTtsEnabled(!ttsEnabled)} title={ttsEnabled ? 'TTS 语音已开启' : 'TTS 语音已关闭'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {ttsEnabled ? (
                      <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
                    ) : (
                      <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                    )}
                  </svg>
                </button>
                <button className="chat-icon-btn" onClick={() => setShowKB(true)} title="知识库">📚</button>
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
                <motion.div key={msg.id} className={`chat-msg ${msg.role}${msg.recalled ? ' recalled' : ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} layout>
                  <div className="chat-msg-content">{msg.recalled ? '⚠ 消息已撤回' : msg.content}</div>
                  <div className="chat-msg-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {msg.role === 'user' && !msg.recalled && (Date.now() - msg.timestamp < 30000) && (
                  <button className="chat-recall-btn" onClick={() => handleRecall(msg.id)} title="撤回消息">撤回</button>
                )}
                  </div>
              {msg.role === 'assistant' && (msg as any).candidates && (
                <div className="chat-candidates">
                  <button className="chat-candidate-btn" onClick={() => handleCandidateSelect(msg.id, 'a', (msg as any).candidates)}
                    title="试试这个风格">
                    {(msg as any).candidates.a.label}
                  </button>
                  <button className="chat-candidate-btn" onClick={() => handleCandidateSelect(msg.id, 'b', (msg as any).candidates)}
                    title="试试这个长度">
                    {(msg as any).candidates.b.label}
                  </button>
                </div>
              )}
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
              {notice && (
                <div className="chat-notice">{notice}</div>
              )}
            </div>
            <div className="chat-input-area">
              <textarea ref={inputRef} className="chat-input" placeholder="对玉瑶说点什么..." autoFocus
                value={input} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={handleKeyDown} disabled={isTyping}
                rows={1}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                }}
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
              <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim() || isTyping || isTTSPlaying()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </div>
            <div className="chat-utility-bar">
              <button className="chat-upload-btn" title="上传文件" onClick={() => document.getElementById('file-upload')?.click()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              </button>
              <button className={`chat-mic-btn${voiceMode === 'mic' ? ' recording' : ''}`} title={voiceMode === 'mic' ? '点击停止语音输入' : '语音输入'} onClick={toggleMic}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
              </button>
              <button className={`chat-phone-btn${voiceMode === 'phone' ? ' active' : ''}`} title={voiceMode === 'phone' ? '点击挂断' : '电话通话'} onClick={togglePhone}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {voiceMode === 'phone' ? <><line x1="22" y1="2" x2="2" y2="22" /><path d="M16 8a5 5 0 0 1 0 8" /><path d="M8 16a5 5 0 0 1 0-8" /></> : <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></>}
                </svg>
              </button>
              <button className={`chat-tts-btn${ttsEnabled ? '' : ' muted'}`} onClick={() => setTtsEnabled(!ttsEnabled)} title={ttsEnabled ? 'TTS 语音已开启' : 'TTS 语音已关闭'}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {ttsEnabled ? (
                    <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
                  ) : (
                    <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                  )}
                </svg>
              </button>
              <button className={`chat-tts-btn`} onClick={() => setShowKB(true)} title="知识库管理">📚</button>
              <button className="chat-refresh-btn" title="刷新页面" onClick={() => location.reload()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {showKB && <KnowledgePanel onClose={() => setShowKB(false)} />}
    </>
  );
}
