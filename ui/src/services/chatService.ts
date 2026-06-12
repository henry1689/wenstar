/**
 * ChatService — 玉瑶聊天 API 客户端
 *
 * 连接 Hermes 后端（src/webui/server.ts, 默认端口 3000）
 * 开发模式下通过 Vite proxy 转发 /api → localhost:3000
 * Tauri 生产模式下使用绝对路径 http://localhost:3000/api
 */
import { useChatStore } from '../store/chatStore';
import { pushChatModules } from './thoughtService';

// TTS 音频状态回调（用于 ChatPanel 暂停/恢复语音识别，防止回声死循环）
let _onTTSAudioState: ((state: 'playing' | 'idle') => void) | null = null;
export function setOnTTSAudioState(cb: ((state: 'playing' | 'idle') => void) | null) {
  _onTTSAudioState = cb;
}

/** 中断 TTS 播放（用户打断说话时调用） */
export function stopTTS() {
  if (_currentAudio && !_currentAudio.paused) {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
    _onTTSAudioState?.('idle');
  }
}

/** 在用户首次交互时调用，解锁音频播放（解决手机自动播放限制） */
export function unlockAudio() {
  const a = new Audio();
  a.volume = 0;
  a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
}

// 通过 Vite proxy (/api → localhost:3000) 转发请求
const API_BASE = '/api';

// 全局音频引用 — 防止多条语音重叠播放（保证同一时间只有一个在播）
let _currentAudio: HTMLAudioElement | null = null;
let _audioLock = false;

interface ChatResponse {
  reply: string;
  turn_count: number;
  m1: any;
  m3: any;
  m4: any;
  m5: any;
  emotionalFlash?: boolean;
  triggeredMemoryId?: string | null;
  audio_url?: string | null;
}

/** 发送消息给玉瑶（SSE 流式输出） */
export function sendMessageStream(message: string): void {
  const store = useChatStore.getState();
  store.setTyping(true);
  store.setError(null);

  // 添加用户消息到对话
  store.addMessage('user', message.trim());

  // SSE 直接连后端 3001 端口（Vite proxy 不支持流式转发）
  const SSE_BASE = 'http://localhost:3001';
  const eventSource = new EventSource(`${SSE_BASE}/api/chat/stream?message=${encodeURIComponent(message.trim())}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'text') {
        store.appendStreamMessage(data.content);
      } else if (data.type === 'meta') {
        store.setTurnCount(data.turn_count);
      } else if (data.type === 'done') {
        store.finalizeStreamMessage();
        store.setTyping(false);
        pushChatModules({ turn_count: store.turnCount, emotionalFlash: false });
        eventSource.close();
      }
    } catch {}
  };

  eventSource.onerror = () => {
    store.setError('连接中断');
    store.setTyping(false);
    eventSource.close();
  };
}
export async function sendMessage(message: string, ttsEnabled: boolean = true): Promise<ChatResponse> {
  const store = useChatStore.getState();
  store.setTyping(true);
  store.setError(null);

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), tts: ttsEnabled }),
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const data: ChatResponse = await res.json();
    store.setTurnCount(data.turn_count);
    store.addMessage('assistant', data.reply);
    store.setTyping(false);

    // 播放 TTS 语音（合并：防重叠锁定 + 回声消除通知）
    if (data.audio_url) {
      try {
        // 停止上一条
        if (_currentAudio) {
          _currentAudio.pause();
          _currentAudio.currentTime = 0;
          _currentAudio.onended = null;
          _currentAudio = null;
        }
        if (_audioLock) {
          await new Promise(r => setTimeout(r, 200));
        }
        _audioLock = true;
        // 同源路径，Vite 代理 /audio → localhost:3001
        const audioUrl = data.audio_url.startsWith('/') ? data.audio_url : data.audio_url;
        const audio = new Audio(audioUrl);
        audio.volume = 0.8;
        _currentAudio = audio;
        audio.onended = () => {
          _currentAudio = null;
          _audioLock = false;
          _onTTSAudioState?.('idle');
        };
        audio.onerror = () => { _audioLock = false; _onTTSAudioState?.('idle'); };
        _onTTSAudioState?.('playing');
        await audio.load();
        audio.play().catch(() => { _onTTSAudioState?.('idle'); _audioLock = false; });
      } catch { _audioLock = false; _onTTSAudioState?.('idle'); }
    }

    // 将 M1-M5 分析结果注入思维流
    pushChatModules(data);
    if (data.m3) useChatStore.getState().setM3Data(data.m3);

    // 情绪传染 flash
    if (data.emotionalFlash) {
      store.triggerFlash(data.triggeredMemoryId ?? undefined);
    }

    return data;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '连接失败';
    store.setError(errorMsg);
    store.setTyping(false);
    throw err;
  }
}

/** 获取后端状态 */
export async function fetchStatus() {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`Status error: ${res.status}`);
  return res.json();
}

/** 获取后端健康检查报告 */
export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health error: ${res.status}`);
  return res.json();
}

/** 重置对话 */
export async function resetConversation() {
  const res = await fetch(`${API_BASE}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`Reset error: ${res.status}`);
  useChatStore.getState().clearMessages();
  return res.json();
}

/** 检测后端是否在线 */
export async function checkBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/modules`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

/** 从后端加载对话历史（重启后恢复上一轮对话） */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}
export async function fetchConversation(): Promise<ConversationTurn[]> {
  try {
    const res = await fetch(`${API_BASE}/conversation`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.turns || [];
  } catch { return []; }
}
