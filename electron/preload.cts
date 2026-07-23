import { contextBridge, ipcRenderer } from "electron";

type ChatChunk = { id: string; type: "delta" | "done" | "error"; delta?: string; error?: string };
type WorkspaceChunk = {
  id: string;
  type: "stdout" | "stderr" | "done" | "error";
  data?: string;
  code?: number | null;
  timedOut?: boolean;
  error?: string;
};

contextBridge.exposeInMainWorld("desktopLLM", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: {
    ollamaUrl?: string;
    openRouterKey?: string;
    workFolder?: string;
    codingWorkFolder?: string;
    webAccess?: boolean;
  }) => ipcRenderer.invoke("settings:save", settings),
  listModels: (provider: "ollama" | "openrouter") => ipcRenderer.invoke("models:list", provider),
  pickWorkFolder: () => ipcRenderer.invoke("folders:pick"),
  pickDocuments: () => ipcRenderer.invoke("documents:pick"),
  exportChat: (args: unknown) => ipcRenderer.invoke("chat:export", args),
  sendChat: (args: unknown) => ipcRenderer.invoke("chat:send", args),
  stopChat: (id: string) => ipcRenderer.invoke("chat:stop", id),
  onChunk: (listener: (chunk: ChatChunk) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, chunk: ChatChunk) => listener(chunk);
    ipcRenderer.on("chat:chunk", wrapped);
    return () => ipcRenderer.removeListener("chat:chunk", wrapped);
  },
  workspaceList: (root: string) => ipcRenderer.invoke("workspace:list", root),
  workspaceRead: (root: string, relativePath: string) => ipcRenderer.invoke("workspace:read", root, relativePath),
  workspaceWrite: (root: string, relativePath: string, content: string) => ipcRenderer.invoke("workspace:write", root, relativePath, content),
  workspaceRun: (args: { id: string; root: string; command: string }) => ipcRenderer.invoke("workspace:run", args),
  workspaceStop: (id: string) => ipcRenderer.invoke("workspace:stop", id),
  onWorkspaceChunk: (listener: (chunk: WorkspaceChunk) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, chunk: WorkspaceChunk) => listener(chunk);
    ipcRenderer.on("workspace:chunk", wrapped);
    return () => ipcRenderer.removeListener("workspace:chunk", wrapped);
  },
});
