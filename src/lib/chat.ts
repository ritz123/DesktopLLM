export type Provider = "ollama" | "openrouter";
export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: "streaming" | "complete" | "error";
}

export interface ChatState {
  messages: ChatMessage[];
}

export type ChatAction =
  | { type: "appendDelta"; conversationId: string; delta: string }
  | { type: "completeAssistant"; conversationId: string }
  | { type: "replace"; messages: ChatMessage[] };

export const initialChatState: ChatState = { messages: [] };

export function reduceChat(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "replace") return { messages: action.messages };
  if (action.type === "appendDelta") {
    const last = state.messages.at(-1);
    if (last?.role === "assistant" && last.conversationId === action.conversationId) {
      return { messages: [...state.messages.slice(0, -1), { ...last, content: last.content + action.delta, status: "streaming" }] };
    }
    return {
      messages: [...state.messages, {
        id: crypto.randomUUID(),
        conversationId: action.conversationId,
        role: "assistant",
        content: action.delta,
        createdAt: new Date().toISOString(),
        status: "streaming",
      }],
    };
  }
  return { messages: state.messages.map((message) => message.conversationId === action.conversationId && message.role === "assistant" ? { ...message, status: "complete" } : message) };
}
