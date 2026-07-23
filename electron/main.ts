import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentTools, executeTool, ToolCall } from "./tools.js";

type Provider = "ollama" | "openrouter";
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type Settings = { ollamaUrl: string; openRouterKey?: string; allowedFolders?: string[]; webAccess?: boolean };

let windowRef: BrowserWindow | null = null;
const controllers = new Map<string, AbortController>();
const settingsPath = () => join(app.getPath("userData"), "settings.json");

async function getSettings(): Promise<Settings> {
  try {
    const stored = JSON.parse(await readFile(settingsPath(), "utf8")) as Settings;
    return {
      ollamaUrl: stored.ollamaUrl || "http://127.0.0.1:11434",
      allowedFolders: stored.allowedFolders || [], webAccess: stored.webAccess ?? true,
      openRouterKey: stored.openRouterKey && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored.openRouterKey, "base64")) : undefined,
    };
  } catch { return { ollamaUrl: "http://127.0.0.1:11434", allowedFolders: [], webAccess: true }; }
}

async function saveSettings(patch: Partial<Settings>) {
  const old = await getSettings();
  const key = patch.openRouterKey ?? old.openRouterKey;
  const encrypted = key && safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString("base64") : undefined;
  await writeFile(settingsPath(), JSON.stringify({ ollamaUrl: patch.ollamaUrl || old.ollamaUrl, openRouterKey: encrypted, allowedFolders: patch.allowedFolders ?? old.allowedFolders, webAccess: patch.webAccess ?? old.webAccess }), "utf8");
}

function providerError(provider: Provider, status?: number) {
  if (provider === "ollama") return "Ollama is unavailable. Start Ollama and check its configured URL.";
  if (status === 401) return "OpenRouter rejected the API key. Update it in Settings.";
  return "OpenRouter is unavailable. Check your network connection and API key.";
}

async function runOllamaAgent(event: Electron.IpcMainInvokeEvent, id: string, settings: Settings, model: string, messages: ChatMessage[], systemPrompt: string, temperature: number) {
  const url = `${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  const toolPolicy = [
    "You are an agent with native tools.",
    "When a user needs current internet information, immediately call web_search with a useful query; do not ask for permission or merely describe the tool.",
    "Use fetch_page only after search when page details are needed.",
    "Use local file tools only for the user's requested work. Never claim a tool result you did not receive.",
    "After a tool result, answer the user directly and cite relevant URLs or file paths.",
  ].join(" ");
  let history: unknown[] = [{ role: "system", content: `${systemPrompt.trim()}\n\n${toolPolicy}`.trim() }, ...messages];
  for (let step = 0; step < 4; step++) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: history, stream: false, tools: agentTools, options: { temperature } }) });
    if (!response.ok) throw new Error(providerError("ollama", response.status));
    const payload = await response.json() as { message: { content?: string; tool_calls?: ToolCall[] } };
    const calls = payload.message.tool_calls || [];
    if (!calls.length) {
      if (payload.message.content) event.sender.send("chat:chunk", { id, type: "delta", delta: payload.message.content });
      event.sender.send("chat:chunk", { id, type: "done" });
      return;
    }
    history.push(payload.message);
    for (const call of calls) {
      event.sender.send("chat:chunk", { id, type: "tool", name: call.function.name, status: "running" });
      const result = await executeTool(call, settings.allowedFolders || []);
      event.sender.send("chat:chunk", { id, type: "tool", name: result.name, status: "complete", content: result.content.slice(0, 300) });
      history.push({ role: "tool", tool_name: result.name, content: result.content });
    }
  }
  throw new Error("Tool-call limit reached.");
}

async function listModels(provider: Provider) {
  const settings = await getSettings();
  try {
    if (provider === "ollama") {
      const result = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/tags`);
      if (!result.ok) throw new Error(String(result.status));
      const data = await result.json() as { models: { name: string }[] };
      const checked = await Promise.all(data.models.map(async ({ name }) => {
        const details = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: name }),
        });
        if (!details.ok) return null;
        const metadata = await details.json() as { capabilities?: string[] };
        return metadata.capabilities?.includes("tools") ? { provider, id: name, label: name } : null;
      }));
      return checked.filter((model): model is { provider: "ollama"; id: string; label: string } => model !== null);
    }
    if (!settings.openRouterKey) return [];
    const result = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${settings.openRouterKey}` } });
    if (!result.ok) throw new Error(String(result.status));
    const data = await result.json() as { data: { id: string; name?: string }[] };
    return data.data.map(({ id, name }) => ({ provider, id, label: name || id }));
  } catch { throw new Error(providerError(provider)); }
}

async function streamChat(event: Electron.IpcMainInvokeEvent, id: string, provider: Provider, model: string, messages: ChatMessage[], systemPrompt: string, temperature: number) {
  const settings = await getSettings();
  const controller = new AbortController();
  controllers.set(id, controller);
  const allMessages = systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
  try {
    if (provider === "ollama") {
      await runOllamaAgent(event, id, settings, model, messages, systemPrompt, temperature);
      return;
    }
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.openRouterKey}` }, body: JSON.stringify({ model, messages: allMessages, stream: true, temperature }) });
    if (!response.ok || !response.body) throw new Error(providerError(provider, response.status));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const raw = provider === "openrouter" ? line.replace(/^data:\s*/, "") : line;
        if (!raw || raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) event.sender.send("chat:chunk", { id, type: "delta", delta });
        } catch { /* wait for a complete line */ }
      }
    }
    event.sender.send("chat:chunk", { id, type: "done" });
  } catch (error) {
    if (!controller.signal.aborted) event.sender.send("chat:chunk", { id, type: "error", error: error instanceof Error ? error.message : "Request failed" });
  } finally { controllers.delete(id); }
}

function createWindow() {
  windowRef = new BrowserWindow({ width: 1320, height: 860, minWidth: 980, minHeight: 640, backgroundColor: "#1e1c19", webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false } });
  windowRef.loadFile(join(app.getAppPath(), "dist", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:save", (_event, patch: Partial<Settings>) => saveSettings(patch));
  ipcMain.handle("models:list", (_event, provider: Provider) => listModels(provider));
  ipcMain.handle("folders:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "multiSelections", "createDirectory"] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("chat:send", (event, args) => streamChat(event, args.id, args.provider, args.model, args.messages, args.systemPrompt, args.temperature));
  ipcMain.handle("chat:stop", (_event, id: string) => controllers.get(id)?.abort());
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
