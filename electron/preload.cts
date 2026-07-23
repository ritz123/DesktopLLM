import { contextBridge, ipcRenderer } from "electron";

type ChatChunk = { id: string; type: "delta" | "done" | "error"; delta?: string; error?: string };

contextBridge.exposeInMainWorld("desktopLLM", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: { ollamaUrl?: string; openRouterKey?: string }) => ipcRenderer.invoke("settings:save", settings),
  listModels: (provider: "ollama" | "openrouter") => ipcRenderer.invoke("models:list", provider),
  pickFolders: () => ipcRenderer.invoke("folders:pick"),
  pickDocuments: () => ipcRenderer.invoke("documents:pick"),
  sendChat: (args: unknown) => ipcRenderer.invoke("chat:send", args),
  stopChat: (id: string) => ipcRenderer.invoke("chat:stop", id),
  onChunk: (listener: (chunk: ChatChunk) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, chunk: ChatChunk) => listener(chunk);
    ipcRenderer.on("chat:chunk", wrapped);
    return () => ipcRenderer.removeListener("chat:chunk", wrapped);
  },
});
