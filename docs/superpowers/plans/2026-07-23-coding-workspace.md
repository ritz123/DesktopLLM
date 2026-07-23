# Coding Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Code tab with a bounded project workspace, editable files, automatic but restricted terminal execution, and coding-agent chat for Ollama and OpenRouter.

**Architecture:** Add a focused Electron workspace service that owns root containment, file access, command policy, and child processes. Expose it over a narrow preload bridge, then render the Code tab through a reducer-backed React workspace view. Route provider-specific tool calls through a shared agent loop that returns streaming statuses to the Code UI.

**Tech Stack:** Electron 35, React 18, TypeScript 5.7, Vitest 3, existing Ollama/OpenRouter HTTP APIs.

## Global Constraints

- Support Linux with Node.js 22+.
- File and command operations must remain inside a user-selected workspace root.
- Both Ollama and OpenRouter must be supported.
- Commands run without approval but must reject destructive, privileged, and out-of-workspace operations.
- Existing Chat behavior must remain unchanged.

---

## File Structure

- Create `electron/workspace.ts`: root validation, tree/read/write helpers, command policy, process lifecycle.
- Create `electron/workspace.test.ts`: unit coverage for containment and command policy.
- Create `src/lib/workspace.ts`: renderer types and reducer for editor tabs, terminal events, and coding messages.
- Create `src/lib/workspace.test.ts`: reducer coverage.
- Modify `electron/main.ts`: workspace IPC and provider-neutral coding agent loop.
- Modify `electron/preload.cts`: typed workspace bridge.
- Modify `src/vite-env.d.ts`: renderer declarations for workspace APIs and coding events.
- Modify `src/App.tsx`: top-level Chat/Code selection and Code tab composition.
- Modify `src/styles.css`: layout and states for explorer, editor, terminal, and coding pane.

### Task 1: Workspace filesystem and command boundary

**Files:**
- Create: `electron/workspace.ts`
- Test: `electron/workspace.test.ts`

**Interfaces:**
- Produces: `readWorkspaceFile(root, relativePath)`, `writeWorkspaceFile(root, relativePath, content)`, `listWorkspaceTree(root)`, `runWorkspaceCommand(root, command, onOutput)`, and `isAllowedWorkspaceCommand(command)`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(await readWorkspaceFile(root, "../outside.txt")).rejects.toThrow("outside the workspace");
expect(isAllowedWorkspaceCommand("npm test")).toBe(true);
expect(isAllowedWorkspaceCommand("sudo apt install git")).toBe(false);
expect(isAllowedWorkspaceCommand("rm -rf .")).toBe(false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- electron/workspace.test.ts`
Expected: FAIL because `workspace.ts` does not exist.

- [ ] **Step 3: Implement the bounded service**

```ts
export async function resolveWorkspacePath(root: string, relativePath: string) {
  const base = await realpath(root);
  const target = resolve(base, relativePath);
  if (relative(base, target).startsWith("..") || isAbsolute(relative(base, target))) {
    throw new Error("Path is outside the workspace.");
  }
  return target;
}
```

Implement text-size and binary-file limits, omit ignored heavy directories (`node_modules`, `.git`, `dist`), create parent folders for writes, and run commands with `cwd: root`, a 60-second timeout, and streamed stdout/stderr.

- [ ] **Step 4: Run tests to verify the boundary**

Run: `npm test -- electron/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/workspace.ts electron/workspace.test.ts
git commit -m "feat: add bounded coding workspace service"
```

### Task 2: Workspace IPC and coding-agent protocol

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.cts`
- Modify: `src/vite-env.d.ts`
- Test: `electron/workspace.test.ts`

**Interfaces:**
- Consumes: `listWorkspaceTree`, `readWorkspaceFile`, `writeWorkspaceFile`, and `runWorkspaceCommand`.
- Produces: `window.desktopLLM.pickWorkspace()`, `workspaceList`, `workspaceRead`, `workspaceWrite`, `runWorkspaceCommand`, `stopWorkspaceCommand`, `sendCodingChat`, and `onCodingChunk`.

- [ ] **Step 1: Write the failing protocol test**

```ts
expect(normalizeOpenRouterToolCall({
  function: { name: "workspace_read_file", arguments: "{\"path\":\"src/App.tsx\"}" },
})).toEqual({ function: { name: "workspace_read_file", arguments: { path: "src/App.tsx" } } });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- electron/workspace.test.ts`
Expected: FAIL because the normalizer is absent.

- [ ] **Step 3: Add IPC and shared coding tools**

```ts
const codingTools = [
  { type: "function", function: { name: "workspace_read_file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "workspace_write_file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "workspace_run_command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];
```

Register workspace IPC handlers in `main.ts`; forward file and terminal events as `coding:chunk`; implement a maximum of six provider tool iterations; map native Ollama and OpenRouter function calls to the same execution function.

- [ ] **Step 4: Run tests and type checking**

Run: `npm test -- electron/workspace.test.ts && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.cts src/vite-env.d.ts electron/workspace.test.ts
git commit -m "feat: expose coding workspace agent bridge"
```

### Task 3: Renderer workspace state

**Files:**
- Create: `src/lib/workspace.ts`
- Test: `src/lib/workspace.test.ts`

**Interfaces:**
- Produces: `WorkspaceState`, `initialWorkspaceState`, and `reduceWorkspace`.

- [ ] **Step 1: Write the failing reducer tests**

```ts
const opened = reduceWorkspace(initialWorkspaceState, { type: "openFile", file: { path: "src/App.tsx", content: "one" } });
expect(opened.tabs).toHaveLength(1);
expect(reduceWorkspace(opened, { type: "changeFile", path: "src/App.tsx", content: "two" }).tabs[0].dirty).toBe(true);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/workspace.test.ts`
Expected: FAIL because the reducer is absent.

- [ ] **Step 3: Implement the state boundary**

```ts
export type WorkspaceTab = { path: string; content: string; dirty: boolean };
export type WorkspaceState = { root: string; tree: WorkspaceEntry[]; tabs: WorkspaceTab[]; activePath: string; terminal: string[]; messages: ChatMessage[] };
```

Add actions for selecting the root, replacing tree data, opening/changing/saving/closing tabs, appending terminal output, and appending/completing coding-message chunks.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace.ts src/lib/workspace.test.ts
git commit -m "feat: add coding workspace renderer state"
```

### Task 4: Code tab UI and integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `README.md`
- Test: `src/lib/workspace.test.ts`

**Interfaces:**
- Consumes: `window.desktopLLM` workspace methods and `reduceWorkspace`.
- Produces: an accessible Code tab with a workspace picker, recursive explorer, editable tabs, terminal transcript, and coding composer.

- [ ] **Step 1: Extend tests for streamed UI state**

```ts
expect(reduceWorkspace(initialWorkspaceState, {
  type: "terminalOutput", output: "$ npm test\nPASS",
}).terminal).toEqual(["$ npm test\nPASS"]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/workspace.test.ts`
Expected: FAIL until terminal reducer support is added.

- [ ] **Step 3: Compose the Code tab**

```tsx
{activeView === "code" && (
  <section className="code-workspace">
    <aside className="file-explorer">…</aside>
    <section className="editor-panel">…</section>
    <aside className="coding-assistant">…</aside>
  </section>
)}
```

Add a view switch beside the brand, a “Open workspace” button, keyboard save support (`Ctrl/Cmd+S`), terminal cancellation, model/provider selectors reused from Chat, and visible errors for failed API calls. Document workspace selection, automated command restrictions, and supported providers in `README.md`.

- [ ] **Step 4: Run complete verification**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css README.md src/lib/workspace.ts src/lib/workspace.test.ts
git commit -m "feat: add dedicated coding workspace tab"
```

### Task 5: Manual Electron verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: packaged Electron application and code workspace.
- Produces: documented launch and verification instructions.

- [ ] **Step 1: Launch the packaged app**

Run: `./run.sh`
Expected: DesktopLLM opens with Chat and Code controls.

- [ ] **Step 2: Verify core flow**

Open a small project, edit and save a text file, run `npm test`, prompt each provider to inspect a file, and confirm command output is displayed. Attempt `sudo whoami`, `rm -rf .`, and `cat ../outside-file`; each must be rejected.

- [ ] **Step 3: Record verified behavior**

Add the precise Code tab use and safety behavior to `README.md`.

- [ ] **Step 4: Run final checks**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document coding workspace verification"
```
