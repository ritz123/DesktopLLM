/// <reference types="vite/client" />

type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceEntry[];
};

interface Window {
  desktopLLM: {
    getSettings(): Promise<{
      ollamaUrl: string;
      workFolder?: string;
      codingWorkFolder?: string;
      webAccess: boolean;
      theme: "dark" | "light";
    }>;
    saveSettings(settings: {
      ollamaUrl?: string;
      openRouterKey?: string;
      workFolder?: string;
      codingWorkFolder?: string;
      webAccess?: boolean;
      theme?: "dark" | "light";
    }): Promise<void>;
    openOpenRouterKeys(): Promise<void>;
    listModels(provider: "ollama" | "openrouter"): Promise<{ provider: "ollama" | "openrouter"; id: string; label: string }[]>;
    pickWorkFolder(): Promise<string | null>;
    pickDocuments(): Promise<string[]>;
    exportChat(args: unknown): Promise<void>;
    sendChat(args: unknown): Promise<void>;
    stopChat(id: string): Promise<void>;
    onChunk(listener: (chunk: { id: string; type: "delta" | "done" | "error" | "tool"; delta?: string; error?: string; name?: string; status?: "running" | "complete"; content?: string }) => void): () => void;
    workspaceList(root: string): Promise<WorkspaceEntry[]>;
    workspaceRead(root: string, relativePath: string): Promise<string>;
    workspaceWrite(root: string, relativePath: string, content: string): Promise<void>;
    workspaceRun(args: { id: string; root: string; command: string }): Promise<void>;
    workspaceStop(id: string): Promise<void>;
    workspaceWatch(root: string): Promise<void>;
    workspaceUnwatch(): Promise<void>;
    onWorkspaceChunk(listener: (chunk: {
      id: string;
      type: "stdout" | "stderr" | "done" | "error";
      data?: string;
      code?: number | null;
      timedOut?: boolean;
      error?: string;
    }) => void): () => void;
    onWorkspaceChange(listener: (change: { path: string }) => void): () => void;
  };
}
