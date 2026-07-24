import { FormEvent, KeyboardEvent, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import CodingView from "./CodingView";
import { ChatMessage, parseChatMessages, reduceChat } from "./lib/chat";
import { clampPaneSize } from "./lib/panes";
import { shouldFallbackToOllama } from "./lib/provider";
import { needsWorkspaceSetup } from "./lib/workspaceSetup";

type Provider = "ollama" | "openrouter";
type Theme = "dark" | "light";
type AppView = "chat" | "coding";
type Conversation = { id: string; title: string; createdAt: string; workFolder?: string };
type Model = { provider: Provider; id: string; label: string };
const storageKey = "desktopllm-conversations";
const messageStorageKey = "desktopllm-messages";
const sidebarWidthKey = "desktopllm-chat-sidebar-width";
const inspectorWidthKey = "desktopllm-chat-inspector-width";
const workspaceSetupSeenKey = "desktopllm-workspace-setup-seen";

function loadConversations(): Conversation[] {
  try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
}

function loadPaneSize(key: string, fallback: number, minimum: number, maximum: number) {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? clampPaneSize(stored, minimum, maximum) : fallback;
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>("chat");
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string>(() => loadConversations()[0]?.id || crypto.randomUUID());
  const [state, dispatch] = useReducer(reduceChat, {
    messages: parseChatMessages(localStorage.getItem(messageStorageKey)),
  });
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [openRouterFallback, setOpenRouterFallback] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState("Connecting to OpenRouter…");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [temperature, setTemperature] = useState(0.7);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceSetupOpen, setWorkspaceSetupOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [webAccess, setWebAccess] = useState(true);
  const [theme, setTheme] = useState<Theme>("dark");
  const [defaultWorkFolder, setDefaultWorkFolder] = useState<string | undefined>();
  const [codingWorkFolder, setCodingWorkFolder] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadPaneSize(sidebarWidthKey, 248, 180, 420));
  const [inspectorWidth, setInspectorWidth] = useState(() => loadPaneSize(inspectorWidthKey, 276, 220, 460));
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const activeMessages = useMemo(() => state.messages.filter((message) => message.conversationId === activeId), [activeId, state.messages]);
  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [activeId, conversations]);
  const workFolder = activeConversation?.workFolder ?? defaultWorkFolder;
  const latestMessage = activeMessages.at(-1);

  function setConversationWorkFolder(conversationId: string, folder: string) {
    setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, workFolder: folder } : item));
    setDefaultWorkFolder(folder);
    void window.desktopLLM.saveSettings({ workFolder: folder });
  }

  async function pickWorkFolder() {
    const picked = await window.desktopLLM.pickWorkFolder();
    if (!picked) return workFolder ?? null;
    setConversationWorkFolder(activeId, picked);
    setNotice(`Work folder set to ${picked}`);
    return picked;
  }

  async function configureStartupWorkspace() {
    const picked = await window.desktopLLM.pickWorkFolder();
    if (picked) {
      setDefaultWorkFolder(picked);
      setCodingWorkFolder(picked);
      await window.desktopLLM.saveSettings({ workFolder: picked, codingWorkFolder: picked });
    }
    localStorage.setItem(workspaceSetupSeenKey, "true");
    setWorkspaceSetupOpen(false);
  }

  async function pickCodingWorkFolder() {
    const picked = await window.desktopLLM.pickWorkFolder();
    if (!picked) return codingWorkFolder ?? null;
    setCodingWorkFolder(picked);
    void window.desktopLLM.saveSettings({ codingWorkFolder: picked });
    return picked;
  }

  function setCodingFolder(folder: string) {
    setCodingWorkFolder(folder);
    void window.desktopLLM.saveSettings({ codingWorkFolder: folder });
  }

  async function ensureWorkFolder() {
    if (workFolder) return workFolder;
    return pickWorkFolder();
  }

  useEffect(() => {
    window.desktopLLM.getSettings().then((settings) => {
      setOllamaUrl(settings.ollamaUrl);
      setDefaultWorkFolder(settings.workFolder);
      setCodingWorkFolder(settings.codingWorkFolder);
      setWorkspaceSetupOpen(needsWorkspaceSetup(settings.workFolder, settings.codingWorkFolder) && !localStorage.getItem(workspaceSetupSeenKey));
      setWebAccess(settings.webAccess);
      setTheme(settings.theme);
    }).catch(() => setNotice("Desktop bridge unavailable. Launch via Electron."));
    return window.desktopLLM.onChunk((chunk) => {
      if (chunk.id !== activeId) return;
      if (chunk.type === "delta" && chunk.delta) dispatch({ type: "appendDelta", conversationId: activeId, delta: chunk.delta });
      if (chunk.type === "done") { dispatch({ type: "completeAssistant", conversationId: activeId }); setStreaming(false); }
      if (chunk.type === "error") { dispatch({ type: "failAssistant", conversationId: activeId }); setNotice(chunk.error || "The response failed."); setStreaming(false); }
    });
  }, [activeId]);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => { localStorage.setItem(messageStorageKey, JSON.stringify(state.messages)); }, [state.messages]);
  useEffect(() => {
    if (stickToBottomRef.current) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [activeId, latestMessage?.id, latestMessage?.content]);
  useEffect(() => {
    setModels([]); setModel("");
    window.desktopLLM.listModels(provider).then((found) => {
      if (shouldFallbackToOllama(provider, found.length)) {
        setOpenRouterFallback(true);
        setProvider("ollama");
        return;
      }
      if (provider === "openrouter") setOpenRouterFallback(false);
      setModels(found);
      setModel(found[0]?.id || "");
      setNotice(openRouterFallback && provider === "ollama" ? "OpenRouter needs a valid API key. Using Ollama." : `${found.length} ${provider} models available.`);
    }).catch((error: Error) => {
      if (provider === "openrouter") {
        setOpenRouterFallback(true);
        setProvider("ollama");
        return;
      }
      setNotice(error.message);
    });
  }, [provider]);

  function newConversation() {
    const id = crypto.randomUUID();
    setConversations((items) => [{ id, title: "New conversation", createdAt: new Date().toISOString(), workFolder: defaultWorkFolder }, ...items]);
    setActiveId(id);
  }

  function deleteConversation(conversationId: string) {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation || !window.confirm(`Delete "${conversation.title}"? This cannot be undone.`)) return;
    const remaining = conversations.filter((item) => item.id !== conversationId);
    if (conversationId === activeId && streaming) {
      window.desktopLLM.stopChat(activeId);
      setStreaming(false);
    }
    setConversations(remaining);
    dispatch({ type: "removeConversation", conversationId });
    if (conversationId === activeId) setActiveId(remaining[0]?.id || crypto.randomUUID());
    setNotice("Conversation deleted.");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !model || streaming) return;
    const folder = await ensureWorkFolder();
    if (!folder) {
      setNotice("Choose a work folder so the assistant can read, write, and run commands in your project.");
      return;
    }
    const message: ChatMessage = { id: crypto.randomUUID(), conversationId: activeId, role: "user", content: prompt.trim(), createdAt: new Date().toISOString(), status: "complete" };
    dispatch({ type: "replace", messages: [...state.messages, message] });
    dispatch({ type: "startAssistant", conversationId: activeId });
    setConversations((items) => items.some((item) => item.id === activeId) ? items.map((item) => item.id === activeId ? { ...item, title: item.title === "New conversation" ? message.content.slice(0, 42) : item.title } : item) : [{ id: activeId, title: message.content.slice(0, 42), createdAt: message.createdAt, workFolder: folder }, ...items]);
    setPrompt(""); setAttachments([]); setStreaming(true); setNotice(`Reading ${attachments.length ? `${attachments.length} attached document${attachments.length === 1 ? "" : "s"} and ` : ""}streaming from ${model}…`);
    await window.desktopLLM.sendChat({ id: activeId, provider, model, messages: [...activeMessages, message].map(({ role, content }) => ({ role, content })), systemPrompt, temperature, attachments, workFolder: folder });
  }

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function exportMessage(message: ChatMessage, format: "text" | "pdf") {
    const title = conversations.find((item) => item.id === activeId)?.title || "DesktopLLM-message";
    void window.desktopLLM.exportChat({ format, title, messages: [message] });
  }

  function trackTranscriptScroll() {
    const transcript = transcriptRef.current;
    if (transcript) stickToBottomRef.current = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 64;
  }

  function beginHorizontalResize(
    event: ReactPointerEvent<HTMLDivElement>,
    side: "left" | "right",
    startSize: number,
    minimum: number,
    maximum: number,
    setSize: (size: number) => void,
    storageKey: string,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX;
      const size = clampPaneSize(startSize + (side === "left" ? delta : -delta), minimum, maximum);
      setSize(size);
      localStorage.setItem(storageKey, String(size));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function saveSettings() {
    await window.desktopLLM.saveSettings({ ollamaUrl, webAccess, theme, ...(openRouterKey ? { openRouterKey } : {}) });
    setOpenRouterKey(""); setSettingsOpen(false); setNotice("Settings saved. Refresh the model source to reconnect.");
  }

  const shellStyle = {
    "--chat-sidebar-width": `${sidebarWidth}px`,
    "--inspector-width": `${inspectorWidth}px`,
  } as CSSProperties;

  return <main className={`app-shell theme-${theme} ${inspectorOpen && activeView === "chat" ? "inspector-open" : ""} ${activeView === "coding" ? "coding-view" : ""}`} style={shellStyle}>
    <aside className="sidebar" aria-label="Navigation">
      <div className="pane-resizer pane-resizer-right" role="separator" aria-label="Resize conversation sidebar" aria-orientation="vertical" onPointerDown={(event) => beginHorizontalResize(event, "left", sidebarWidth, 180, 420, setSidebarWidth, sidebarWidthKey)} />
      <div className="brand"><i /> <span>DesktopLLM</span></div>
      {activeView === "chat" && <>
      <button className="new-chat" onClick={newConversation}>＋ New chat</button>
      <p className="eyebrow">Conversations</p>
      <nav className="conversation-list">{conversations.map((item) => <div className="conversation-row" key={item.id}>
        <button className="delete-conversation" aria-label={`Delete ${item.title}`} title="Delete conversation" onClick={() => deleteConversation(item.id)}>×</button>
        <button className={`conversation ${item.id === activeId ? "active" : ""}`} onClick={() => setActiveId(item.id)}>{item.title}</button>
      </div>)}</nav>
      </>}
      <div className="sidebar-footer"><button className="settings-link" onClick={() => setSettingsOpen(true)}>Settings</button><button className="settings-link" onClick={() => setAboutOpen(true)}>About DesktopLLM</button></div>
    </aside>
    <section className="main-view">
      <nav className="view-tabs" aria-label="Application views">
        <button type="button" className={activeView === "chat" ? "active" : ""} onClick={() => setActiveView("chat")}>Chat</button>
        <button type="button" className={activeView === "coding" ? "active" : ""} onClick={() => setActiveView("coding")}>Coding</button>
      </nav>
      {activeView === "chat" ? <section className="chat-pane">
      <header><div><strong>{conversations.find((item) => item.id === activeId)?.title || "New conversation"}</strong><span>{provider === "ollama" ? "Local model" : "OpenRouter"}</span></div><div className="header-actions"><button className="model-status" onClick={() => setProvider(provider === "ollama" ? "openrouter" : "ollama")}>{provider === "ollama" ? "● Ollama" : "● OpenRouter"}</button><button className="inspector-toggle" aria-label={inspectorOpen ? "Hide conversation controls" : "Show conversation controls"} aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16M16 3v4M9 10v4M18 17v4" /></svg></button></div></header>
      <div className="notice" role="status">{notice}</div>
      <div className="messages" ref={transcriptRef} onScroll={trackTranscriptScroll}>{activeMessages.length === 0 ? <div className="welcome"><h1>What would you like to work on?</h1><p>Select a work folder, then ask the assistant to read, edit, and run commands in that project. Your conversations remain on this device.</p></div> : activeMessages.map((message) => <article key={message.id} className={`message ${message.role}`}><div className="message-header"><span className="message-role">{message.role === "user" ? "You" : "Assistant"}</span><span className={`message-status ${message.status || "complete"}`}>{message.role === "user" ? "Sent" : message.status === "streaming" ? "Thinking…" : message.status === "error" ? "Failed" : "Complete"}</span></div><div className="markdown">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{message.content}</ReactMarkdown> : message.status === "streaming" ? "Thinking…" : ""}</div>{message.content && <div className="message-actions"><button onClick={() => void navigator.clipboard.writeText(message.content)}>Copy</button><button onClick={() => exportMessage(message, "text")}>Raw text</button><button onClick={() => exportMessage(message, "pdf")}>PDF</button></div>}</article>)}</div>
      <form className="composer" onSubmit={send}>
        <div className="work-folder" aria-label="Work folder">
          <button type="button" className="work-folder-button" onClick={() => void pickWorkFolder()}>
            {workFolder ? workFolder.split(/[\\/]/).pop() : "Select work folder"}
          </button>
          {workFolder && <span className="work-folder-path" title={workFolder}>{workFolder}</span>}
        </div>{attachments.length > 0 && <div className="attachments" aria-label="Attached documents">{attachments.map((path) => <span className="attachment" key={path}>{path.split(/[\\/]/).pop()}<button type="button" aria-label={`Remove ${path.split(/[\\/]/).pop()}`} onClick={() => setAttachments((items) => items.filter((item) => item !== path))}>×</button></span>)}</div>}<textarea aria-label="Message composer" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={sendOnEnter} placeholder="Message your model…" rows={3} /><div><span>{model || "Choose a model"}</span><div className="composer-actions"><button className="attach-button" type="button" aria-label="Attach documents" onClick={() => void window.desktopLLM.pickDocuments().then((files) => setAttachments((items) => [...new Set([...items, ...files])]))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12 6.5-6.5a3.5 3.5 0 1 1 5 5L10 20a5 5 0 0 1-7-7l9-9" /></svg></button><button type={streaming ? "button" : "submit"} onClick={() => streaming && window.desktopLLM.stopChat(activeId)} disabled={!streaming && (!prompt.trim() || !model)}>{streaming ? "Stop" : "Send ↑"}</button></div></div></form>
    </section> : <CodingView
      workFolder={codingWorkFolder}
      onPickWorkFolder={pickCodingWorkFolder}
      onWorkFolderChange={setCodingFolder}
      provider={provider}
      models={models}
      model={model}
      onProviderChange={setProvider}
      onModelChange={setModel}
    />}
    </section>
    {activeView === "chat" && inspectorOpen && <aside className="inspector" aria-label="Model controls">
      <div className="pane-resizer pane-resizer-left" role="separator" aria-label="Resize conversation controls" aria-orientation="vertical" onPointerDown={(event) => beginHorizontalResize(event, "right", inspectorWidth, 220, 460, setInspectorWidth, inspectorWidthKey)} />
      <h2>Conversation</h2><label>Model source<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="ollama">Ollama (local)</option><option value="openrouter">OpenRouter</option></select></label>
      <label>Active model<select aria-label="Active model" value={model} onChange={(event) => setModel(event.target.value)}><option value="">Select a model</option>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>System prompt<textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={5} /></label>
      <label>Temperature <output>{temperature.toFixed(1)}</output><input aria-label="Temperature" type="range" min="0" max="1" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
      <div className="privacy"><b>Privacy</b><p>Messages are stored locally. No telemetry is sent.</p></div>
    </aside>}
    {settingsOpen && <div className="modal-backdrop"><form className="settings-dialog" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}><h2>Settings</h2><label>Theme<select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Ollama URL<input value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} /></label><label>OpenRouter API key<input type="password" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder="Stored with OS encryption" /></label><p className="openrouter-setup">New to OpenRouter? Create an account and generate an API key.</p><button type="button" className="settings-link" onClick={() => void window.desktopLLM.openOpenRouterKeys()}>Open OpenRouter API keys</button><label><input type="checkbox" checked={webAccess} onChange={(event) => setWebAccess(event.target.checked)} /> Allow web tools</label><footer><button type="button" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="primary" type="submit">Save settings</button></footer></form></div>}
    {workspaceSetupOpen && <div className="modal-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-setup-title"><h2 id="workspace-setup-title">Choose a workspace folder</h2><p>Select a folder for the assistant to read and write files in. You can change it later.</p><footer><button type="button" onClick={() => { localStorage.setItem(workspaceSetupSeenKey, "true"); setWorkspaceSetupOpen(false); }}>Skip for now</button><button type="button" className="primary" onClick={() => void configureStartupWorkspace()}>Choose folder</button></footer></section></div>}
    {aboutOpen && <div className="modal-backdrop"><section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title"><img src="../build/icon.png" alt="" /><p className="eyebrow">DesktopLLM</p><h2 id="about-title">Local-first AI workspace</h2><p>Version 0.1.0</p><p>Chat with Ollama models on this device or OpenRouter models online. Conversations stay local; OpenRouter keys use OS encryption.</p><p>Select a work folder in chat so compatible Ollama models can read, write, and run commands there.</p><p className="license">Licensed under GNU GPL v3.0</p><p className="copyright">© 2026 Biplab Sarkar</p><footer><button className="primary" onClick={() => setAboutOpen(false)}>Close</button></footer></section></div>}
  </main>;
}
