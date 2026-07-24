import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useReducer, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChatMessage, parseChatMessages, reduceChat } from "./lib/chat";
import { clampPaneSize } from "./lib/panes";

type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceEntry[];
};

type EditorTab = {
  path: string;
  content: string;
  dirty: boolean;
};

type Props = {
  workFolder: string | undefined;
  onPickWorkFolder: () => Promise<string | null>;
  onWorkFolderChange: (folder: string) => void;
  provider: "ollama" | "openrouter";
  models: { id: string; label: string }[];
  model: string;
  onProviderChange: (provider: "ollama" | "openrouter") => void;
  onModelChange: (model: string) => void;
};

const explorerWidthKey = "desktopllm-coding-explorer-width";
const assistantWidthKey = "desktopllm-coding-assistant-width";
const codingMessageStorageKey = "desktopllm-coding-messages";

function loadPaneSize(key: string, fallback: number, minimum: number, maximum: number) {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? clampPaneSize(stored, minimum, maximum) : fallback;
}

function flattenFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) => entry.type === "directory"
    ? flattenFiles(entry.children || [])
    : [entry]);
}

function TreeNode({
  entry,
  depth,
  activePath,
  onOpen,
}: {
  entry: WorkspaceEntry;
  depth: number;
  activePath: string;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (entry.type === "directory") {
    return (
      <div className="tree-directory">
        <button
          type="button"
          className="tree-row directory"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="tree-chevron">{open ? "▾" : "▸"}</span>
          {entry.name}
        </button>
        {open && entry.children?.map((child) => (
          <TreeNode key={child.path} entry={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
        ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`tree-row file ${entry.path === activePath ? "active" : ""}`}
      style={{ paddingLeft: `${20 + depth * 12}px` }}
      onClick={() => onOpen(entry.path)}
    >
      {entry.name}
    </button>
  );
}

export default function CodingView({
  workFolder,
  onPickWorkFolder,
  onWorkFolderChange,
  provider,
  models,
  model,
  onProviderChange,
  onModelChange,
}: Props) {
  const [tree, setTree] = useState<WorkspaceEntry[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingTree, setLoadingTree] = useState(false);
  const [chatState, dispatchChat] = useReducer(reduceChat, {
    messages: parseChatMessages(localStorage.getItem(codingMessageStorageKey)),
  });
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(() => loadPaneSize(explorerWidthKey, 252, 180, 480));
  const [assistantWidth, setAssistantWidth] = useState(() => loadPaneSize(assistantWidthKey, 420, 260, 900));
  const chatId = "coding-workspace";
  const chatMessages = useMemo(
    () => chatState.messages.filter((message) => message.conversationId === chatId),
    [chatState.messages],
  );

  useEffect(() => {
    localStorage.setItem(codingMessageStorageKey, JSON.stringify(chatState.messages));
  }, [chatState.messages]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath),
    [activePath, tabs],
  );

  const refreshTree = useCallback(async (root: string, quiet = false) => {
    setLoadingTree(true);
    try {
      const entries = await window.desktopLLM.workspaceList(root);
      setTree(entries);
      if (!quiet) setNotice(`Workspace loaded: ${root}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to load workspace tree.");
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    if (!workFolder) return;
    void refreshTree(workFolder);
  }, [refreshTree, workFolder]);

  useEffect(() => {
    if (!workFolder) return;
    void window.desktopLLM.workspaceWatch(workFolder).catch((error: Error) => {
      setNotice(error.message || "Could not watch workspace files.");
    });
    return () => { void window.desktopLLM.workspaceUnwatch(); };
  }, [workFolder]);

  useEffect(() => window.desktopLLM.onWorkspaceChange((change) => {
    if (!workFolder) return;
    void refreshTree(workFolder, true);
    const tab = tabs.find((item) => item.path === change.path);
    if (!tab) return;
    if (tab.dirty) {
      setNotice(`${change.path} changed on disk. Your unsaved editor changes were kept.`);
      return;
    }
    void window.desktopLLM.workspaceRead(workFolder, change.path).then((content) => {
      setTabs((items) => items.map((item) => item.path === change.path && !item.dirty
        ? { ...item, content, dirty: false }
        : item));
      setNotice(`Reloaded ${change.path} after a disk change.`);
    }).catch(() => {
      setNotice(`${change.path} was removed or can no longer be opened.`);
    });
  }), [refreshTree, tabs, workFolder]);

  useEffect(() => window.desktopLLM.onChunk((chunk) => {
    if (chunk.id !== chatId) return;
    if (chunk.type === "delta" && chunk.delta) {
      dispatchChat({ type: "appendDelta", conversationId: chatId, delta: chunk.delta });
    }
    if (chunk.type === "done") {
      dispatchChat({ type: "completeAssistant", conversationId: chatId });
      setStreaming(false);
    }
    if (chunk.type === "error") {
      dispatchChat({ type: "failAssistant", conversationId: chatId });
      setNotice(chunk.error || "The coding assistant response failed.");
      setStreaming(false);
    }
  }), []);

  async function chooseFolder() {
    const picked = await onPickWorkFolder();
    if (!picked) return;
    onWorkFolderChange(picked);
    setTabs([]);
    setActivePath("");
  }

  async function openFile(path: string) {
    if (!workFolder) return;
    const existing = tabs.find((tab) => tab.path === path);
    if (existing) {
      setActivePath(path);
      return;
    }
    try {
      const content = await window.desktopLLM.workspaceRead(workFolder, path);
      setTabs((items) => [...items, { path, content, dirty: false }]);
      setActivePath(path);
      setNotice(`Opened ${path}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not open ${path}`);
    }
  }

  function updateActiveContent(content: string) {
    if (!activePath) return;
    setTabs((items) => items.map((tab) => tab.path === activePath ? { ...tab, content, dirty: true } : tab));
  }

  async function saveActiveFile() {
    if (!workFolder || !activeTab || !activeTab.dirty) return;
    try {
      await window.desktopLLM.workspaceWrite(workFolder, activeTab.path, activeTab.content);
      setTabs((items) => items.map((tab) => tab.path === activeTab.path ? { ...tab, dirty: false } : tab));
      setNotice(`Saved ${activeTab.path}`);
      await refreshTree(workFolder);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Save failed.");
    }
  }

  function closeTab(path: string) {
    setTabs((items) => items.filter((tab) => tab.path !== path));
    if (activePath === path) {
      const remaining = tabs.filter((tab) => tab.path !== path);
      setActivePath(remaining.at(-1)?.path || "");
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !model || streaming) return;
    const selectedWorkFolder = workFolder || await onPickWorkFolder();
    if (!selectedWorkFolder) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: chatId,
      role: "user",
      content: prompt.trim(),
      createdAt: new Date().toISOString(),
      status: "complete",
    };
    dispatchChat({ type: "addMessage", message });
    dispatchChat({ type: "startAssistant", conversationId: chatId });
    setPrompt("");
    setStreaming(true);
    await window.desktopLLM.sendChat({
      id: chatId,
      provider,
      model,
      messages: [...chatMessages, message].map(({ role, content }) => ({ role, content })),
      systemPrompt: "You are a coding assistant. Help the user work safely in the selected coding workspace.",
      temperature: 0.2,
      workFolder: selectedWorkFolder,
    });
  }

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveActiveFile();
    }
  }

  function beginResize(
    event: ReactPointerEvent<HTMLDivElement>,
    axis: "horizontal" | "vertical",
    direction: 1 | -1,
    startSize: number,
    minimum: number,
    maximum: number,
    setSize: (size: number) => void,
    storageKey: string,
  ) {
    event.preventDefault();
    const startPosition = axis === "horizontal" ? event.clientX : event.clientY;
    const onMove = (move: PointerEvent) => {
      const currentPosition = axis === "horizontal" ? move.clientX : move.clientY;
      const delta = currentPosition - startPosition;
      const size = clampPaneSize(startSize + direction * delta, minimum, maximum);
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

  const workspaceStyle = {
    "--coding-explorer-width": `${explorerWidth}px`,
    "--coding-assistant-width": `${assistantWidth}px`,
  } as CSSProperties;

  if (!workFolder) {
    return (
      <section className="coding-pane">
        <div className="coding-empty">
          <h1>Coding workspace</h1>
          <p>Select a work folder to browse files, edit text, and run commands in your project.</p>
          <button type="button" className="primary" onClick={() => void chooseFolder()}>Select work folder</button>
        </div>
      </section>
    );
  }

  return (
    <section className="coding-pane" onKeyDown={handleKeyDown}>
      <header className="coding-header">
        <div>
          <strong>{workFolder.split(/[\\/]/).pop()}</strong>
          <span title={workFolder}>{workFolder}</span>
        </div>
        <div className="coding-header-actions">
          <button type="button" onClick={() => void refreshTree(workFolder)} disabled={loadingTree}>
            {loadingTree ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={() => void chooseFolder()}>Change folder</button>
          <button type="button" className="primary" onClick={() => void saveActiveFile()} disabled={!activeTab?.dirty}>
            Save
          </button>
        </div>
      </header>
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="coding-workspace" style={workspaceStyle}>
        <aside className="file-explorer" aria-label="Project files">
          <div className="pane-resizer pane-resizer-right" role="separator" aria-label="Resize file explorer" aria-orientation="vertical" onPointerDown={(event) => beginResize(event, "horizontal", 1, explorerWidth, 180, 480, setExplorerWidth, explorerWidthKey)} />
          <p className="eyebrow">Files</p>
          <div className="tree-root">
            {tree.length === 0 ? <p className="tree-empty">No files yet.</p> : tree.map((entry) => (
              <TreeNode key={entry.path} entry={entry} depth={0} activePath={activePath} onOpen={(path) => void openFile(path)} />
            ))}
          </div>
          <p className="tree-meta">{flattenFiles(tree).length} files</p>
        </aside>
        <section className="editor-panel">
          <div className="editor-tabs" role="tablist">
            {tabs.length === 0 ? <span className="editor-placeholder">Open a file from the explorer</span> : tabs.map((tab) => (
              <button
                key={tab.path}
                type="button"
                role="tab"
                aria-selected={tab.path === activePath}
                className={`editor-tab ${tab.path === activePath ? "active" : ""}`}
                onClick={() => setActivePath(tab.path)}
              >
                {tab.path.split("/").pop()}{tab.dirty ? " •" : ""}
                <span
                  className="editor-tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${tab.path}`}
                  onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      closeTab(tab.path);
                    }
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          {activeTab ? (
            <textarea
              className="code-editor"
              aria-label={`Editor for ${activeTab.path}`}
              value={activeTab.content}
              onChange={(event) => updateActiveContent(event.target.value)}
              spellCheck={false}
            />
          ) : (
            <div className="editor-empty">Choose a file to start editing.</div>
          )}
        </section>
        <section className="coding-assistant" aria-label="Coding assistant">
            <div className="pane-resizer pane-resizer-left" role="separator" aria-label="Resize coding assistant" aria-orientation="vertical" onPointerDown={(event) => beginResize(event, "horizontal", -1, assistantWidth, 260, 900, setAssistantWidth, assistantWidthKey)} />
            <div className="coding-assistant-header">
              <span>Assistant</span>
              <div>
                <select aria-label="Coding assistant provider" value={provider} onChange={(event) => onProviderChange(event.target.value as "ollama" | "openrouter")}>
                  <option value="ollama">Ollama</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
                <select aria-label="Coding assistant model" value={model} onChange={(event) => onModelChange(event.target.value)}>
                  <option value="">Select a model</option>
                  {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
            </div>
            <div className="coding-messages">
              {chatMessages.length === 0 ? <p>Ask about the project or an open file.</p> : chatMessages.map((message) => (
                <article key={message.id} className={`coding-message ${message.role}`}>
                  <div className="message-header"><span className="message-role">{message.role === "user" ? "You" : "Assistant"}</span>
                  <span className={`message-status ${message.status || "complete"}`}>{message.role === "user" ? "Sent" : message.status === "streaming" ? "Thinking…" : message.status === "error" ? "Failed" : "Complete"}</span></div>
                  <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{message.content || "Thinking…"}</ReactMarkdown></div>
                </article>
              ))}
            </div>
            <form className="coding-composer" onSubmit={sendChat}>
              <textarea aria-label="Coding assistant message" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={sendOnEnter} placeholder="Ask the coding assistant…" rows={2} />
              <button type={streaming ? "button" : "submit"} onClick={() => streaming && window.desktopLLM.stopChat(chatId)} disabled={!streaming && (!prompt.trim() || !model)}>
                {streaming ? "Stop" : "Send ↑"}
              </button>
            </form>
          </section>
      </div>
    </section>
  );
}
