import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { executeTool, formatToolError, isAllowedCommand, normalizeToolCall, ToolCall, toolsForAgent } from "./tools.js";
import { extractDocuments } from "./documents.js";
import { isFreeOpenRouterModel, type OpenRouterModel } from "./models.js";
import { normalizeOpenRouterToolCall, type OpenRouterToolCall } from "./openrouter.js";
import {
  isIgnoredWorkspacePath,
  listWorkspaceTree,
  readWorkspaceFile,
  resolveWorkspacePath,
  runWorkspaceCommand,
  writeWorkspaceFile,
  type WorkspaceCommand,
} from "./workspace.js";

type Provider = "ollama" | "openrouter";
type Theme = "dark" | "light";
type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type Settings = {
  ollamaUrl: string;
  openRouterKey?: string;
  workFolder?: string;
  codingWorkFolder?: string;
  webAccess?: boolean;
  theme?: Theme;
};

let windowRef: BrowserWindow | null = null;
const controllers = new Map<string, AbortController>();
const workspaceCommands = new Map<string, WorkspaceCommand>();
const workspaceWatchers = new Map<number, FSWatcher>();
const settingsPath = () => join(app.getPath("userData"), "settings.json");

async function getSettings(): Promise<Settings> {
  try {
    const stored = JSON.parse(await readFile(settingsPath(), "utf8")) as Settings & { allowedFolders?: string[] };
    return {
      ollamaUrl: stored.ollamaUrl || "http://127.0.0.1:11434",
      workFolder: stored.workFolder || stored.allowedFolders?.[0],
      codingWorkFolder: stored.codingWorkFolder,
      webAccess: stored.webAccess ?? true,
      theme: stored.theme === "light" ? "light" : "dark",
      openRouterKey: stored.openRouterKey && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored.openRouterKey, "base64")) : undefined,
    };
  } catch { return { ollamaUrl: "http://127.0.0.1:11434", webAccess: true, theme: "dark" }; }
}

async function saveSettings(patch: Partial<Settings>) {
  const old = await getSettings();
  const key = patch.openRouterKey ?? old.openRouterKey;
  const encrypted = key && safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString("base64") : undefined;
  await writeFile(settingsPath(), JSON.stringify({
    ollamaUrl: patch.ollamaUrl || old.ollamaUrl,
    openRouterKey: encrypted,
    workFolder: patch.workFolder ?? old.workFolder,
    codingWorkFolder: patch.codingWorkFolder ?? old.codingWorkFolder,
    webAccess: patch.webAccess ?? old.webAccess,
    theme: patch.theme ?? old.theme,
  }), "utf8");
}

function providerError(provider: Provider, status?: number) {
  if (provider === "ollama") return "Ollama is unavailable. Start Ollama and check its configured URL.";
  if (status === 401) return "OpenRouter rejected the API key. Update it in Settings.";
  return "OpenRouter is unavailable. Check your network connection and API key.";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

async function exportChat(format: "text" | "pdf", title: string, messages: ChatMessage[]) {
  const extension = format === "pdf" ? "pdf" : "txt";
  const result = await dialog.showSaveDialog({ defaultPath: `${title || "DesktopLLM-chat"}.${extension}`, filters: [{ name: format === "pdf" ? "PDF" : "Text", extensions: [extension] }] });
  if (result.canceled || !result.filePath) return;
  const transcript = messages.map((message) => `${message.role === "assistant" ? "Assistant" : message.role === "user" ? "You" : "System"}:\n${message.content}`).join("\n\n");
  if (format === "text") {
    await writeFile(result.filePath, transcript, "utf8");
    return;
  }
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px system-ui;color:#222;margin:48px;line-height:1.55}h1{font-size:24px}article{margin:0 0 24px;break-inside:avoid}h2{font-size:12px;text-transform:uppercase;color:#85513e;margin:0 0 8px}pre{white-space:pre-wrap;font:13px ui-monospace,monospace;background:#f4f1ed;padding:12px;border-radius:6px}</style></head><body><h1>${escapeHtml(title || "DesktopLLM chat")}</h1>${messages.map((message) => `<article><h2>${message.role}</h2><pre>${escapeHtml(message.content)}</pre></article>`).join("")}</body></html>`;
  await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await writeFile(result.filePath, await printer.webContents.printToPDF({ printBackground: true }));
  printer.close();
}

async function requestFinalOllamaAnswer(url: string, model: string, history: unknown[], temperature: number) {
  history.push({
    role: "system",
    content: "Tool use is no longer available. Answer the user now using the attached document text and any tool results already provided. Do not request more tools.",
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: history, stream: false, options: { temperature } }),
  });
  if (!response.ok) throw new Error(providerError("ollama", response.status));
  const payload = await response.json() as { message: { content?: string } };
  const content = payload.message.content?.trim();
  if (!content) throw new Error("The model returned an empty response.");
  return content;
}

async function runOllamaAgent(event: Electron.IpcMainInvokeEvent, id: string, settings: Settings, model: string, messages: ChatMessage[], systemPrompt: string, temperature: number, workFolder?: string) {
  const url = `${settings.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  const toolPolicy = [
    "You are an agent with native tools.",
    workFolder
      ? `The user's work folder is ${workFolder}. Read, write, and run commands only inside that folder.`
      : "No work folder is selected yet; ask the user to choose one before using local file or command tools.",
    "When a user needs current internet information, immediately call web_search with a useful query; do not ask for permission or merely describe the tool.",
    "Use fetch_page only after search when page details are needed.",
    "Use run_command for builds, tests, and other shell tasks. Commands run as the current user without sudo.",
    "Use local file tools only for the user's requested work. Never claim a tool result you did not receive.",
    "After a tool result, answer the user directly and cite relevant URLs or file paths.",
  ].join(" ");
  let history: unknown[] = [{ role: "system", content: `${systemPrompt.trim()}\n\n${toolPolicy}`.trim() }, ...messages];
  const tools = toolsForAgent(settings.webAccess ?? true);
  for (let step = 0; step < 4; step++) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: history, stream: false, tools, options: { temperature } }) });
    if (!response.ok) throw new Error(providerError("ollama", response.status));
    const payload = await response.json() as { message: { content?: string; tool_calls?: ToolCall[] } };
    const calls = payload.message.tool_calls || [];
    if (!calls.length) {
      const content = payload.message.content?.trim() || await requestFinalOllamaAnswer(url, model, history, temperature);
      event.sender.send("chat:chunk", { id, type: "delta", delta: content });
      event.sender.send("chat:chunk", { id, type: "done" });
      return;
    }
    history.push(payload.message);
    for (const call of calls) {
      const normalizedCall = normalizeToolCall(call);
      event.sender.send("chat:chunk", { id, type: "tool", name: normalizedCall.function.name, status: "running" });
      let result: { name: string; content: string };
      try {
        result = await executeTool(normalizedCall, workFolder, settings.webAccess ?? true);
      } catch (error) {
        result = {
          name: normalizedCall.function.name,
          content: formatToolError(normalizedCall.function.name, error),
        };
      }
      event.sender.send("chat:chunk", { id, type: "tool", name: result.name, status: "complete", content: result.content.slice(0, 300) });
      history.push({ role: "tool", tool_name: result.name, content: result.content });
    }
  }
  event.sender.send("chat:chunk", { id, type: "delta", delta: await requestFinalOllamaAnswer(url, model, history, temperature) });
  event.sender.send("chat:chunk", { id, type: "done" });
}

async function runOpenRouterAgent(event: Electron.IpcMainInvokeEvent, id: string, settings: Settings, model: string, messages: unknown[], temperature: number, workFolder?: string) {
  const tools = toolsForAgent(settings.webAccess ?? true);
  for (let step = 0; step < 4; step++) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controllers.get(id)?.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.openRouterKey}` },
      body: JSON.stringify({ model, messages, tools, temperature }),
    });
    if (!response.ok) throw new Error(providerError("openrouter", response.status));
    const payload = await response.json() as { choices?: { message?: { content?: string; tool_calls?: OpenRouterToolCall[] } }[] };
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("The model returned an empty response.");
    const calls = message.tool_calls || [];
    if (!calls.length) {
      if (message.content) event.sender.send("chat:chunk", { id, type: "delta", delta: message.content });
      event.sender.send("chat:chunk", { id, type: "done" });
      return;
    }
    messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });
    for (const rawCall of calls) {
      const { id: toolCallId, call } = normalizeOpenRouterToolCall(rawCall);
      const normalized = normalizeToolCall(call);
      event.sender.send("chat:chunk", { id, type: "tool", name: normalized.function.name, status: "running" });
      let result: { name: string; content: string };
      try { result = await executeTool(normalized, workFolder, settings.webAccess ?? true); }
      catch (error) { result = { name: normalized.function.name, content: formatToolError(normalized.function.name, error) }; }
      event.sender.send("chat:chunk", { id, type: "tool", name: result.name, status: "complete", content: result.content.slice(0, 300) });
      messages.push({ role: "tool", tool_call_id: toolCallId, content: result.content });
    }
  }
  throw new Error("The model exceeded the tool-call limit.");
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
    const data = await result.json() as { data: OpenRouterModel[] };
    return data.data
      .filter(isFreeOpenRouterModel)
      .map(({ id, name }) => ({ provider, id, label: name || id }));
  } catch { throw new Error(providerError(provider)); }
}

async function streamChat(event: Electron.IpcMainInvokeEvent, id: string, provider: Provider, model: string, messages: ChatMessage[], systemPrompt: string, temperature: number, attachments: string[] = [], workFolder?: string) {
  const settings = await getSettings();
  const controller = new AbortController();
  controllers.set(id, controller);
  const attachmentContext = attachments.length ? await extractDocuments(attachments) : "";
  const enrichedMessages = attachmentContext && messages.length
    ? [...messages.slice(0, -1), { ...messages.at(-1)!, content: `${messages.at(-1)!.content}\n\n${attachmentContext}` }]
    : messages;
  const allMessages = systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt }, ...enrichedMessages] : enrichedMessages;
  try {
    if (provider === "ollama") {
      await runOllamaAgent(event, id, settings, model, enrichedMessages, systemPrompt, temperature, workFolder);
      return;
    }
    const toolPolicy = [
      "You are an agent with access to native tools.",
      workFolder ? `The user's work folder is ${workFolder}. Read, write, and run commands only inside that folder.` : "No work folder is selected yet; ask the user to choose one before using local file or command tools.",
      "For current information, including news, immediately call web_search before answering. Do not claim you lack internet access when a web tool is available.",
      "Use fetch_page after search when page details are needed.",
      "Use local file tools only for the user's requested work and never claim a tool result you did not receive.",
    ].join(" ");
    await runOpenRouterAgent(event, id, settings, model, [{ role: "system", content: `${systemPrompt.trim()}\n\n${toolPolicy}`.trim() }, ...allMessages.filter((message) => message.role !== "system")], temperature, workFolder);
  } catch (error) {
    if (!controller.signal.aborted) event.sender.send("chat:chunk", { id, type: "error", error: error instanceof Error ? error.message : "Request failed" });
  } finally { controllers.delete(id); }
}

function createWindow() {
  windowRef = new BrowserWindow({ width: 1320, height: 860, minWidth: 980, minHeight: 640, frame: false, icon: join(app.getAppPath(), "build", "icon.png"), backgroundColor: "#1e1c19", webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false } });
  windowRef.loadFile(join(app.getAppPath(), "dist", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:save", (_event, patch: Partial<Settings>) => saveSettings(patch));
  ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized()) window.unmaximize(); else window?.maximize();
  });
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("openrouter:keys", () => shell.openExternal("https://openrouter.ai/keys"));
  ipcMain.handle("models:list", (_event, provider: Provider) => listModels(provider));
  ipcMain.handle("folders:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  ipcMain.handle("documents:pick", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Documents", extensions: ["pdf", "docx", "md", "markdown", "txt"] }],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("chat:export", (_event, args: { format: "text" | "pdf"; title: string; messages: ChatMessage[] }) => exportChat(args.format, args.title, args.messages));
  ipcMain.handle("chat:send", (event, args: {
    id: string;
    provider: Provider;
    model: string;
    messages: ChatMessage[];
    systemPrompt: string;
    temperature: number;
    attachments?: string[];
    workFolder?: string;
  }) => streamChat(event, args.id, args.provider, args.model, args.messages, args.systemPrompt, args.temperature, args.attachments, args.workFolder));
  ipcMain.handle("chat:stop", (_event, id: string) => controllers.get(id)?.abort());
  ipcMain.handle("workspace:list", (_event, root: string) => listWorkspaceTree(root));
  ipcMain.handle("workspace:read", (_event, root: string, relativePath: string) => readWorkspaceFile(root, relativePath));
  ipcMain.handle("workspace:write", (_event, root: string, relativePath: string, content: string) => writeWorkspaceFile(root, relativePath, content));
  ipcMain.handle("workspace:run", async (event, args: { id: string; root: string; command: string }) => {
    if (!isAllowedCommand(args.command)) {
      throw new Error("Privileged commands like sudo are not allowed.");
    }
    const command = await runWorkspaceCommand(args.root, args.command, (stream, data) => {
      event.sender.send("workspace:chunk", { id: args.id, type: stream, data });
    });
    workspaceCommands.set(args.id, command);
    try {
      const result = await command.completion;
      event.sender.send("workspace:chunk", {
        id: args.id,
        type: "done",
        code: result.code,
        timedOut: result.timedOut,
      });
    } catch (error) {
      event.sender.send("workspace:chunk", {
        id: args.id,
        type: "error",
        error: error instanceof Error ? error.message : "Command failed",
      });
    } finally {
      workspaceCommands.delete(args.id);
    }
  });
  ipcMain.handle("workspace:stop", (_event, id: string) => workspaceCommands.get(id)?.stop());
  ipcMain.handle("workspace:watch", async (event, root: string) => {
    const senderId = event.sender.id;
    workspaceWatchers.get(senderId)?.close();
    const workspaceRoot = await resolveWorkspacePath(root, ".");
    const watcher = watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const path = relative(workspaceRoot, join(workspaceRoot, filename.toString())).replaceAll("\\", "/");
      if (!path || path.startsWith("..") || isIgnoredWorkspacePath(path)) return;
      event.sender.send("workspace:changed", { path });
    });
    workspaceWatchers.set(senderId, watcher);
    event.sender.once("destroyed", () => {
      workspaceWatchers.get(senderId)?.close();
      workspaceWatchers.delete(senderId);
    });
  });
  ipcMain.handle("workspace:unwatch", (event) => {
    const senderId = event.sender.id;
    workspaceWatchers.get(senderId)?.close();
    workspaceWatchers.delete(senderId);
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
