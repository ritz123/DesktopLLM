# Coding Workspace Design

## Goal

Add a dedicated Code tab to DesktopLLM that lets users work with a selected project using an editor, file explorer, integrated terminal, and model-assisted coding chat.

## Scope

- Keep the existing Chat tab unchanged.
- Add a Code tab with a workspace picker, file tree, multi-tab plain-text editor, terminal panel, and coding chat.
- Support both tool-capable Ollama models and OpenRouter models.
- Let the model read and write workspace files and run terminal commands automatically.
- Run all file and command operations through Electron's main process.

## Architecture

The React renderer owns workspace-view state: selected workspace, file tree, open editor tabs, unsaved buffers, terminal transcript, and coding-chat transcript. The Electron preload bridge exposes typed, workspace-scoped IPC calls only.

The Electron main process owns filesystem access, process execution, tool policy enforcement, provider requests, and streaming events. A selected workspace root is required before coding operations can run. Filesystem paths must resolve within that root.

Ollama uses its native tool-call format. OpenRouter uses its OpenAI-compatible function-calling format. Provider-specific responses are translated to shared coding tool calls and results so the renderer behavior is the same for both providers.

## Interaction Flow

1. The user selects a workspace folder in Code.
2. The renderer requests a filtered file tree and renders it in the explorer.
3. Selecting a file reads it through IPC and opens it in an editor tab.
4. Saving an editor buffer writes it through IPC and refreshes the affected tree/file state.
5. A coding prompt is sent with workspace context and provider-specific tool definitions.
6. The provider requests file or terminal tools; the main process executes them, streams status/output, and supplies results to the provider until it returns a final response.

## Safety and Failure Handling

- Filesystem operations reject paths outside the workspace root.
- Terminal commands use the workspace as their current directory.
- Commands that are privileged, destructive, or explicitly target paths outside the workspace are rejected.
- Commands have a bounded runtime and may be cancelled.
- Tool errors, failed commands, provider errors, and I/O failures are sent back as readable diagnostics; they do not terminate the workspace UI.
- The initial editor is a text editor; binary and oversized files are rejected with a clear message.

## Tests

- Workspace path containment, filtering, and read/write behavior.
- Command-policy acceptance/rejection, timeout, cancellation, and streamed output.
- Tool-call normalization and execution for Ollama and OpenRouter.
- Renderer state reducers for editor tabs, dirty buffers, terminal output, and coding streams.
