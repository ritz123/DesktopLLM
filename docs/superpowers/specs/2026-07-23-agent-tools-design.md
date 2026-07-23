# Agent Tools Design

DesktopLLM adds native model tool calls for constrained web and local-folder tasks. Ollama models are listed for agent use only when `POST /api/show` reports the `tools` capability; no text-parsing fallback is permitted.

The Electron main process owns all I/O. It exposes `web_search`, `fetch_page`, `list_directory`, `read_file`, and `write_file` to compatible models. Web requests accept public HTTP(S) hosts only, revalidate redirects, and return bounded sanitized text. Local requests are confined to user-selected, canonicalized roots; reads and writes reject symlink escapes, hidden sensitive paths, binaries, and oversized content. Writes are atomic and cannot delete, rename, execute, or change permissions.

Tool calls execute automatically per the approved policy, while the renderer shows their query/URL/path and result status in the transcript. The conversation inspector owns the web toggle and selected folders. Tool-capability filtering prevents incompatible Ollama models from appearing in the agent model selector.
