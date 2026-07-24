# Filter free OpenRouter models

## Goal

When the selected provider is OpenRouter, hide free models from every model selector.

## Design

The Electron main process will filter the response from OpenRouter's models endpoint in `listModels` before creating the shared model descriptors returned through IPC. A model is considered free when either its OpenRouter model ID or display name contains `free`, case-insensitively.

Because the renderer receives the already-filtered list, the Chat and Code selectors stay consistent without UI-specific filtering. Ollama model discovery is unchanged.

## Error handling

OpenRouter request and authentication errors retain their current behavior. Models without a display name are evaluated using their ID only.

## Verification

Add a focused test for case-insensitive matching against IDs and display names, including a paid model that remains visible. Run the test suite and TypeScript build.
