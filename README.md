# DesktopLLM

DesktopLLM is a Linux desktop chat client for locally hosted Ollama models and OpenRouter models. It is built with Electron, React, and TypeScript.

## Features

- Chat with local Ollama or OpenRouter models.
- Persist conversations locally in the application profile.
- Store the OpenRouter API key using Electron OS encryption.
- Stream model responses and stop generation.
- Use tool-capable Ollama models for public-web search/page retrieval and selected-folder operations.
- Select local folders for model-assisted listing, reading, and file creation/overwrite.
- Attach PDF, DOCX, Markdown, and plain-text documents; text is extracted locally before being sent to the selected model.
- Use a responsive three-pane workspace with a collapsible conversation inspector.

## Requirements

- Linux with a graphical desktop session.
- Node.js 22+ and npm.
- For local models, [Ollama](https://ollama.com/) running at `http://127.0.0.1:11434` by default.

When running inside a root-owned container or pod, the launcher automatically passes Electron's required `--no-sandbox` flag. This is appropriate only for an isolated development environment.

## Install

```bash
npm install
```

Electron's postinstall binary may be deferred by the package manager. If `npm run electron` reports that Electron failed to install, run:

```bash
npm rebuild electron --foreground-scripts
```

## Run

```bash
./run.sh
```

The launcher packages the app only when relevant source files are newer than the existing packaged executable, then starts the packaged Linux application.

## Package an AppImage

```bash
npm run package
```

The output is written to:

```text
dist/DesktopLLM-0.1.0.AppImage
```

## Development checks

```bash
npm test
npm run build
```

## Agent tools

Only Ollama models that advertise the native `tools` capability through `/api/show` are shown for agent use. Tool operations run in Electron's main process:

- `web_search` and `fetch_page` access public HTTP(S) endpoints.
- `list_directory`, `read_file`, and `write_file` are restricted to folders selected in Settings.

Tool results and document text are sent to the model you selected. Do not add sensitive folders or documents unless you intend to share their relevant content with that model, especially when using an online OpenRouter model.

## License

Copyright © 2026 Biplab Sarkar.

DesktopLLM is licensed under the [GNU GPL v3.0](LICENSE).
