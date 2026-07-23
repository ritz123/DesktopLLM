/// <reference types="vite/client" />

interface Window {
  desktopLLM: {
    getSettings(): Promise<{ ollamaUrl: string; allowedFolders: string[]; webAccess: boolean }>;
    saveSettings(settings: { ollamaUrl?: string; openRouterKey?: string; allowedFolders?: string[]; webAccess?: boolean }): Promise<void>;
    listModels(provider: "ollama" | "openrouter"): Promise<{ provider: "ollama" | "openrouter"; id: string; label: string }[]>;
    pickFolders(): Promise<string[]>;
    sendChat(args: unknown): Promise<void>;
    stopChat(id: string): Promise<void>;
    onChunk(listener: (chunk: { id: string; type: "delta" | "done" | "error"; delta?: string; error?: string }) => void): () => void;
  };
}
