/**
 * ChatStore — 玉瑶聊天状态管理
 */
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 候选回复（语气/深度变体，供用户选择偏好） */
  candidates?: { a: { text: string; label: string }; b: { text: string; label: string } } | null;
  /** 30秒内撤回标记 */
  recalled?: boolean;
}

interface ChatStore {
  messages: ChatMessage[];
  isOpen: boolean;
  isTyping: boolean;
  error: string | null;
  turnCount: number;
  /** 情绪传染触发时闪烁 */
  emotionalFlash: boolean;
  triggeredMemoryId: string | null;
  m3Data: any | null;
  /** SSE 流式输出缓冲 */
  streamBuffer: string;
  streamMessageId: string | null;

  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  setTyping: (typing: boolean) => void;
  setError: (error: string | null) => void;
  setTurnCount: (count: number) => void;
  setM3Data: (data: any) => void;
  setLastMessageCandidates: (candidates: any) => void;
  clearMessages: () => void;
  recallMessage: (id: string) => void;
  triggerFlash: (memoryId?: string) => void;
  /** SSE 流式操作 */
  appendStreamMessage: (chunk: string) => void;
  finalizeStreamMessage: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isOpen: false,
  isTyping: false,
  error: null,
  turnCount: 0,
  emotionalFlash: false,
  triggeredMemoryId: null,
  m3Data: null,
  streamBuffer: '',
  streamMessageId: null,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),

  addMessage: (role, content) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          content,
          timestamp: Date.now(),
        },
      ],
    })),

  setTyping: (typing) => set({ isTyping: typing }),
  setError: (error) => set({ error }),
  setTurnCount: (count) => set({ turnCount: count }),
  clearMessages: () => set({ messages: [], turnCount: 0, emotionalFlash: false, triggeredMemoryId: null }),
  recallMessage: (id: string) =>
    set((s) => ({
      messages: s.messages.map(m => m.id === id ? { ...m, recalled: true } : m),
    })),
  setLastMessageCandidates: (candidates) =>
    set((s) => {
      const msgs = [...s.messages];
      if (msgs.length > 0) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], candidates };
      return { messages: msgs };
    }),
  setM3Data: (data) => set({ m3Data: data }),
  triggerFlash: (memoryId) => {
    set({ emotionalFlash: true, triggeredMemoryId: memoryId ?? null });
    setTimeout(() => set({ emotionalFlash: false, triggeredMemoryId: null }), 1500);
  },

  /** SSE 流式：追加一个文本块到当前流消息 */
  appendStreamMessage: (chunk: string) => {
    const state = get();
    if (!state.streamMessageId) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      set((s) => ({
        streamMessageId: id,
        messages: [
          ...s.messages,
          { id, role: 'assistant', content: chunk, timestamp: Date.now() },
        ],
      }));
    } else {
      const updated = state.messages.map(m =>
        m.id === state.streamMessageId
          ? { ...m, content: m.content + chunk }
          : m
      );
      set({ messages: updated });
    }
  },

  /** SSE 流式：结束当前流消息，重置缓冲 */
  finalizeStreamMessage: () => {
    set({ streamBuffer: '', streamMessageId: null });
  },
}));
