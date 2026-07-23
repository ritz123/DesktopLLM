import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
};

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

export default function CodingView({ workFolder, onPickWorkFolder, onWorkFolderChange }: Props) {
  const [tree, setTree] = useState<WorkspaceEntry[]>([]);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingTree, setLoadingTree] = useState(false);
  const [command, setCommand] = useState("");
  const [terminal, setTerminal] = useState<string[]>([]);
  const [runningCommand, setRunningCommand] = useState(false);
  const commandIdRef = useRef("");
  const terminalRef = useRef<HTMLPreElement>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath),
    [activePath, tabs],
  );

  const refreshTree = useCallback(async (root: string) => {
    setLoadingTree(true);
    try {
      const entries = await window.desktopLLM.workspaceList(root);
      setTree(entries);
      setNotice(`Workspace loaded: ${root}`);
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
    return window.desktopLLM.onWorkspaceChunk((chunk) => {
      if (chunk.id !== commandIdRef.current) return;
      if (chunk.type === "stdout" || chunk.type === "stderr") {
        setTerminal((lines) => [...lines, chunk.data || ""]);
      }
      if (chunk.type === "done") {
        setTerminal((lines) => [...lines, `\n[exit ${chunk.code ?? "?"}${chunk.timedOut ? ", timed out" : ""}]`]);
        setRunningCommand(false);
        commandIdRef.current = "";
        if (workFolder) void refreshTree(workFolder);
      }
      if (chunk.type === "error") {
        setTerminal((lines) => [...lines, `\n[error] ${chunk.error || "Command failed"}`]);
        setRunningCommand(false);
        commandIdRef.current = "";
      }
    });
  }, [refreshTree, workFolder]);

  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
  }, [terminal]);

  async function chooseFolder() {
    const picked = await onPickWorkFolder();
    if (!picked) return;
    onWorkFolderChange(picked);
    setTabs([]);
    setActivePath("");
    setTerminal([]);
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

  async function runTerminalCommand(event: FormEvent) {
    event.preventDefault();
    if (!workFolder || !command.trim() || runningCommand) return;
    const id = crypto.randomUUID();
    commandIdRef.current = id;
    const line = `$ ${command.trim()}`;
    setTerminal((lines) => [...lines, line]);
    setRunningCommand(true);
    setCommand("");
    try {
      await window.desktopLLM.workspaceRun({ id, root: workFolder, command: line.slice(2) });
    } catch (error) {
      setTerminal((lines) => [...lines, error instanceof Error ? error.message : "Command rejected."]);
      setRunningCommand(false);
      commandIdRef.current = "";
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveActiveFile();
    }
  }

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
      <div className="coding-workspace">
        <aside className="file-explorer" aria-label="Project files">
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
          <section className="terminal-panel" aria-label="Terminal">
            <div className="terminal-header">
              <span>Terminal</span>
              {runningCommand && (
                <button type="button" onClick={() => window.desktopLLM.workspaceStop(commandIdRef.current)}>
                  Stop
                </button>
              )}
            </div>
            <pre className="terminal-output" ref={terminalRef}>{terminal.join("")}</pre>
            <form className="terminal-form" onSubmit={runTerminalCommand}>
              <input
                aria-label="Terminal command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="Run a command in the work folder…"
                disabled={runningCommand}
              />
              <button type="submit" disabled={runningCommand || !command.trim()}>Run</button>
            </form>
          </section>
        </section>
      </div>
    </section>
  );
}
