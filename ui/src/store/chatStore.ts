/**
 * ChatStore — 玉瑶聊天状态管理
 */
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
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

  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  setTyping: (typing: boolean) => void;
  setError: (error: string | null) => void;
  setTurnCount: (count: number) => void;
  clearMessages: () => void;
  triggerFlash: (memoryId?: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isOpen: false,
  isTyping: false,
  error: null,
  turnCount: 0,
  emotionalFlash: false,
  triggeredMemoryId: null,

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
  triggerFlash: (memoryId) => {
    set({ emotionalFlash: true, triggeredMemoryId: memoryId ?? null });
    // 1.5 秒后自动熄灭
    setTimeout(() => set({ emotionalFlash: false, triggeredMemoryId: null }), 1500);
  },
}));
