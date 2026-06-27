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
  if (!_playerAudio.paused) {
    _playerAudio.pause();
    _playerAudio.currentTime = 0;
  }
  _ttsPlaying = false;
  _onTTSAudioState?.('idle');
  if (_playTimer) { _playTimer(); _playTimer = null; }
}

// 全局唯一音频播放器（复用同一个元素，解决手机自动播放限制）
const _playerAudio = new Audio();
_playerAudio.volume = 0.8;
let _audioUnlocked = false;
let _ttsPlaying = false;
let _playTimer: any = null;

/** 在用户首次交互时调用，解锁音频播放（解决手机自动播放限制） */
export function unlockAudio() {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  _playerAudio.src = '';
  _playerAudio.play().then(() => { _playerAudio.pause(); _playerAudio.currentTime = 0; }).catch(() => {});
}

/** TTS 是否正在播放（供 ChatPanel 检测，防止手机麦克风回采导致回声死循环） */
export function isTTSPlaying(): boolean { return _ttsPlaying; }

/** 等待 TTS 播放完毕 */
export function waitTTSDone(): Promise<void> {
  if (!_ttsPlaying) return Promise.resolve();
  return new Promise(r => { _playTimer = r; });
}

// 通过 Vite proxy (/api → localhost:3000) 转发请求
const API_BASE = '/api';

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
  candidates?: any;
}

/** 发送消息给玉瑶（SSE 流式输出） */
export function sendMessageStream(message: string): void {
  const store = useChatStore.getState();
  store.setTyping(true);
  store.setError(null);

  // 添加用户消息到对话
  store.addMessage('user', message.trim());

  // SSE 通过生产服务器代理转发（相对路径，兼容公网隧道）
  // const SSE_BASE removed - using relative path
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

  // 获取刚添加的用户消息的ID，传给后端用于30秒撤回
  const userMessages = store.messages.filter(m => m.role === 'user');
  const clientMsgId = userMessages.length > 0 ? userMessages[userMessages.length - 1].id : null;

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), tts: ttsEnabled, client_msg_id: clientMsgId }),
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const data: ChatResponse = await res.json();
    store.setTurnCount(data.turn_count);
    store.addMessage('assistant', data.reply);
    if (data.candidates) {
      store.setLastMessageCandidates(data.candidates);
    }
    store.setTyping(false);

    // 播放 TTS 语音（iPhone 需要绝对路径）
    if (data.audio_url) {
      const audioUrl = data.audio_url.startsWith('/') ? window.location.origin + data.audio_url : data.audio_url;
      _ttsPlaying = true;
      _playerAudio.src = audioUrl;
      const onDone = () => { _ttsPlaying = false; _onTTSAudioState?.('idle'); if (_playTimer) { _playTimer(); _playTimer = null; } };
      _playerAudio.onended = onDone;
      _playerAudio.onerror = onDone;
      _onTTSAudioState?.('playing');
      _playerAudio.play().catch(() => { onDone(); });
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

/** 撤回已发送的消息 */
export async function recallMessage(messageId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/chat/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
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
