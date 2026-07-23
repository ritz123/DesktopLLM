# DesktopLLM Design Specification

## Goal

Build a Linux desktop chat client that uses a locally running Ollama server and OpenRouter models, while retaining conversations locally and keeping the OpenRouter credential outside the webview.

## Scope

The first release provides model discovery, provider/model selection, streaming chat, conversation persistence, a system prompt, temperature control, and clear connection errors. It deliberately excludes tool use, file attachments, web browsing, MCP, sync, multi-account support, and telemetry.

## Architecture

Electron hosts a React + TypeScript interface compiled by Vite. The Electron main process is the sole network client and owns the provider adapters. The renderer invokes typed, preload-exposed IPC methods to query state, create conversations, and start/stop generation; the main process emits stream events addressed to a conversation ID.

SQLite persists app settings, conversations, and messages at Electron's app-data location. OpenRouter's API key is stored with Electron's `safeStorage`, never in SQLite or browser-accessible JavaScript storage. Ollama uses `http://127.0.0.1:11434` by default and may be changed in Settings.

## Provider Contract

Each provider supplies:

- `list_models() -> Vec<ModelDescriptor>`
- `stream_chat(request, on_delta) -> Result<Usage, AppError>`

The normalized `ModelDescriptor` contains its provider (`ollama` or `openrouter`), model ID, and display name. Messages use `role`, `content`, and creation time. The main process converts requests to Ollama's `/api/chat` JSON-line protocol or OpenRouter's OpenAI-compatible SSE chat-completions protocol.

## UI

The desktop experience uses an original, Claude-inspired dark three-rail workspace:

- The left rail creates/selects/deletes local conversations.
- The center rail shows the conversation transcript and a persistent composer. A selected model indicator and a visible stop action appear while streaming.
- The right rail contains model source, active model, system prompt, temperature, and local-privacy status. Settings provide the Ollama URL and OpenRouter key entry.

The visual system uses warm charcoal surfaces, readable off-white text, muted gray metadata, and a restrained coral action color. All controls are keyboard reachable, have text labels or accessible names, and use stable press/focus states.

## Failure Handling

Ollama connection failures tell the user to start Ollama and show the configured URL. An absent OpenRouter key disables that source and directs the user to Settings. Provider HTTP errors display a concise message and preserve the typed prompt. An interrupted stream records the partial assistant message as failed so the conversation remains inspectable.

## Testing

Main-process unit tests cover provider URL construction, payload transformation, SSE/JSON-line chunk parsing, and error mapping. Frontend tests cover conversation reducer behavior, stream-event accumulation, and key UI states. The production build must compile the Vite frontend and package Electron for Linux.

## Acceptance Criteria

1. A user can see locally installed Ollama models when Ollama is reachable.
2. A user can save an OpenRouter key in the OS keyring, list OpenRouter models, and never expose the key to the UI state or database.
3. A user can select any listed model, submit a prompt, see a streaming response, and stop generation.
4. Restarting the app preserves local conversations and messages.
5. The UI communicates unavailable providers and keeps unsent text after an error.
6. The app builds as an Electron Linux application in the present environment.
