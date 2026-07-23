# DesktopLLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Linux Electron desktop client for locally hosted Ollama and OpenRouter chat models.

**Architecture:** A Vite/React renderer renders the local-first three-rail UI. Electron's main process owns provider network requests, streaming event emission, SQLite persistence, and encrypted credentials; the renderer communicates only through a context-isolated preload bridge and IPC events.

**Tech Stack:** Electron, React 18, TypeScript, Vite, better-sqlite3, Electron safeStorage, Vitest.

## Global Constraints

- Target Linux desktop packaging; develop entirely in the existing workspace/pod.
- Default Ollama URL: `http://127.0.0.1:11434`.
- Store the OpenRouter API key only with Electron `safeStorage`.
- Do not add telemetry, tool execution, MCP, file attachments, or remote data sync.
- Use the original warm-charcoal visual language documented in the approved specification.

---

### Task 1: Scaffold a Tauri React application and test harness

**Files:**
- Create: `package.json`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`
- Create: `electron/main.ts`, `electron/preload.ts`, `electron/ipc.ts`
- Test: `src/lib/chat.test.ts`

**Interfaces:**
- Produces: `npm run test`, `npm run build`, and `npm run package`.

- [ ] **Step 1: Write the failing reducer test**

```ts
expect(reduceChat(initialState, { type: "appendDelta", conversationId: "c1", delta: "Hi" })
  .messages[0].content).toBe("Hi");
```

- [ ] **Step 2: Run `npm run test -- --run` and verify it fails because the module does not exist.**
- [ ] **Step 3: Scaffold the Electron/Vite project and implement the minimal reducer export.**
- [ ] **Step 4: Run `npm run test -- --run` and verify it passes.**
- [ ] **Step 5: Commit: `git add package.json src electron && git commit -m "chore: scaffold DesktopLLM"`**

### Task 2: Implement main-process domain types, SQLite persistence, and credential storage

**Files:**
- Create: `electron/domain.ts`, `electron/store.ts`, `electron/secrets.ts`
- Modify: `electron/ipc.ts`
- Test: `electron/store.test.ts`

**Interfaces:**
- Produces: serializable `Conversation`, `Message`, `Settings`, `ProviderKind`, and `ModelDescriptor` types; `Store.createConversation`, `Store.saveMessage`, `Store.listConversations`; `Secrets.setOpenRouterKey`.

- [ ] **Step 1: Write a failing TypeScript test that creates a conversation and receives an empty message list.**
- [ ] **Step 2: Run `npm run test -- --run electron/store.test.ts` and verify it fails.**
- [ ] **Step 3: Implement the schema and minimal store functions using a temporary SQLite database.**
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Commit: `git add electron && git commit -m "feat: persist chats locally"`**

### Task 3: Implement Ollama and OpenRouter provider adapters

**Files:**
- Create: `electron/providers.ts`
- Modify: `electron/domain.ts`, `electron/ipc.ts`
- Test: `electron/providers.test.ts`

**Interfaces:**
- Produces: `Provider.listModels`, `Provider.streamChat`, and `StreamChunk`.

- [ ] **Step 1: Write failing tests that parse an Ollama JSON-line delta and an OpenRouter SSE delta.**
- [ ] **Step 2: Run `npm run test -- --run electron/providers.test.ts` and verify both tests fail.**
- [ ] **Step 3: Implement request formation and stream parsers; map transport failures to user-safe `AppError` values.**
- [ ] **Step 4: Run the provider tests and verify they pass.**
- [ ] **Step 5: Commit: `git add electron && git commit -m "feat: add Ollama and OpenRouter providers"`**

### Task 4: Expose Tauri commands and connect streaming state

**Files:**
- Modify: `electron/ipc.ts`, `electron/preload.ts`, `src/lib/chat.ts`, `src/lib/chat.test.ts`
- Test: `src/lib/chat.test.ts`

**Interfaces:**
- Consumes: `Store`, `Secrets`, provider adapters.
- Produces: preload methods `bootstrap`, `saveOpenRouterKey`, `setSettings`, `createConversation`, `deleteConversation`, `sendMessage`, `stopGeneration`; event `chat:chunk`.

- [ ] **Step 1: Write a failing reducer test for receiving a partial delta followed by a completed assistant message.**
- [ ] **Step 2: Run `npm run test -- --run` and verify failure.**
- [ ] **Step 3: Implement command handlers and event subscription/reducer flow.**
- [ ] **Step 4: Run frontend and Electron tests.**
- [ ] **Step 5: Commit: `git add src electron && git commit -m "feat: stream provider responses"`**

### Task 5: Build the accessible three-rail desktop UI

**Files:**
- Modify: `src/App.tsx`, `src/styles.css`, `src/main.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: bootstrap data and `chat://chunk` events.
- Produces: a keyboard-accessible conversation rail, transcript/composer, model controls, and Settings dialog.

- [ ] **Step 1: Write a failing UI test asserting that the empty state includes a labelled model selector and message composer.**
- [ ] **Step 2: Run `npm run test -- --run` and verify it fails.**
- [ ] **Step 3: Implement the responsive visual system, focus states, labelled controls, error notices, and reduced-motion-safe styling.**
- [ ] **Step 4: Run frontend tests, `npm run build`, and `npm run package`.**
- [ ] **Step 5: Commit: `git add src && git commit -m "feat: build DesktopLLM chat workspace"`**
