import { FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import { ChatMessage, initialChatState, reduceChat } from "./lib/chat";

type Provider = "ollama" | "openrouter";
type Conversation = { id: string; title: string; createdAt: string };
type Model = { provider: Provider; id: string; label: string };
const storageKey = "desktopllm-conversations";

function loadConversations(): Conversation[] {
  try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string>(() => loadConversations()[0]?.id || crypto.randomUUID());
  const [state, dispatch] = useReducer(reduceChat, initialChatState);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<Provider>("ollama");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState("Connect to Ollama to begin.");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [temperature, setTemperature] = useState(0.7);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [allowedFolders, setAllowedFolders] = useState<string[]>([]);
  const [webAccess, setWebAccess] = useState(true);
  const activeMessages = useMemo(() => state.messages.filter((message) => message.conversationId === activeId), [activeId, state.messages]);

  useEffect(() => {
    window.desktopLLM.getSettings().then((settings) => { setOllamaUrl(settings.ollamaUrl); setAllowedFolders(settings.allowedFolders); setWebAccess(settings.webAccess); }).catch(() => setNotice("Desktop bridge unavailable. Launch via Electron."));
    return window.desktopLLM.onChunk((chunk) => {
      if (chunk.id !== activeId) return;
      if (chunk.type === "delta" && chunk.delta) dispatch({ type: "appendDelta", conversationId: activeId, delta: chunk.delta });
      if (chunk.type === "done") { dispatch({ type: "completeAssistant", conversationId: activeId }); setStreaming(false); }
      if (chunk.type === "error") { setNotice(chunk.error || "The response failed."); setStreaming(false); }
    });
  }, [activeId]);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => {
    setModels([]); setModel("");
    window.desktopLLM.listModels(provider).then((found) => { setModels(found); setModel(found[0]?.id || ""); setNotice(found.length ? `${found.length} ${provider} models available.` : provider === "openrouter" ? "Add an OpenRouter key in Settings." : "No Ollama models found."); }).catch((error: Error) => setNotice(error.message));
  }, [provider]);

  function newConversation() {
    const id = crypto.randomUUID();
    setConversations((items) => [{ id, title: "New conversation", createdAt: new Date().toISOString() }, ...items]);
    setActiveId(id);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !model || streaming) return;
    const message: ChatMessage = { id: crypto.randomUUID(), conversationId: activeId, role: "user", content: prompt.trim(), createdAt: new Date().toISOString(), status: "complete" };
    dispatch({ type: "replace", messages: [...state.messages, message] });
    setConversations((items) => items.some((item) => item.id === activeId) ? items.map((item) => item.id === activeId ? { ...item, title: item.title === "New conversation" ? message.content.slice(0, 42) : item.title } : item) : [{ id: activeId, title: message.content.slice(0, 42), createdAt: message.createdAt }, ...items]);
    setPrompt(""); setStreaming(true); setNotice(`Streaming from ${model}…`);
    await window.desktopLLM.sendChat({ id: activeId, provider, model, messages: [...activeMessages, message].map(({ role, content }) => ({ role, content })), systemPrompt, temperature });
  }

  async function saveSettings() {
    await window.desktopLLM.saveSettings({ ollamaUrl, allowedFolders, webAccess, ...(openRouterKey ? { openRouterKey } : {}) });
    setOpenRouterKey(""); setSettingsOpen(false); setNotice("Settings saved. Refresh the model source to reconnect.");
  }

  return <main className="app-shell">
    <aside className="sidebar" aria-label="Conversations">
      <div className="brand"><i /> <span>DesktopLLM</span></div>
      <button className="new-chat" onClick={newConversation}>＋ New chat</button>
      <p className="eyebrow">Conversations</p>
      <nav>{conversations.map((item) => <button key={item.id} className={`conversation ${item.id === activeId ? "active" : ""}`} onClick={() => setActiveId(item.id)}>{item.title}</button>)}</nav>
      <button className="settings-link" onClick={() => setSettingsOpen(true)}>Settings</button>
    </aside>
    <section className="chat-pane">
      <header><div><strong>{conversations.find((item) => item.id === activeId)?.title || "New conversation"}</strong><span>{provider === "ollama" ? "Local model" : "OpenRouter"}</span></div><button className="model-status" onClick={() => setProvider(provider === "ollama" ? "openrouter" : "ollama")}>{provider === "ollama" ? "● Ollama" : "● OpenRouter"}</button></header>
      <div className="notice" role="status">{notice}</div>
      <div className="messages">{activeMessages.length === 0 ? <div className="welcome"><h1>What would you like to work on?</h1><p>Choose a local Ollama model or connect OpenRouter. Your conversations remain on this device.</p></div> : activeMessages.map((message) => <article key={message.id} className={`message ${message.role}`}><span>{message.role === "user" ? "You" : "Assistant"}</span><p>{message.content || (message.status === "streaming" ? "Thinking…" : "")}</p></article>)}</div>
      <form className="composer" onSubmit={send}><textarea aria-label="Message composer" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Message your model…" rows={3} /><div><span>{model || "Choose a model"}</span><button type={streaming ? "button" : "submit"} onClick={() => streaming && window.desktopLLM.stopChat(activeId)} disabled={!streaming && (!prompt.trim() || !model)}>{streaming ? "Stop" : "Send ↑"}</button></div></form>
    </section>
    <aside className="inspector" aria-label="Model controls">
      <h2>Conversation</h2><label>Model source<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="ollama">Ollama (local)</option><option value="openrouter">OpenRouter</option></select></label>
      <label>Active model<select aria-label="Active model" value={model} onChange={(event) => setModel(event.target.value)}><option value="">Select a model</option>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>System prompt<textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={5} /></label>
      <label>Temperature <output>{temperature.toFixed(1)}</output><input aria-label="Temperature" type="range" min="0" max="1" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
      <div className="privacy"><b>Privacy</b><p>Messages are stored locally. No telemetry is sent.</p></div>
    </aside>
    {settingsOpen && <div className="modal-backdrop"><form className="settings-dialog" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}><h2>Settings</h2><label>Ollama URL<input value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} /></label><label>OpenRouter API key<input type="password" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder="Stored with OS encryption" /></label><label><input type="checkbox" checked={webAccess} onChange={(event) => setWebAccess(event.target.checked)} /> Allow web tools</label><section><b>Allowed folders</b>{allowedFolders.map((folder) => <p key={folder}>{folder}</p>)}<button type="button" onClick={() => void window.desktopLLM.pickFolders().then((folders) => setAllowedFolders((current) => [...new Set([...current, ...folders])]))}>Add folders</button></section><footer><button type="button" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="primary" type="submit">Save settings</button></footer></form></div>}
  </main>;
}
