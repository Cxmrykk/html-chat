# HTML Chat

A lightweight, zero-runtime-dependency web chat client for OpenAI-compatible APIs that builds into a single self-contained `index.html` file. Includes local IndexedDB storage, client-side RAG with vector search, customizable JavaScript pipeline hooks, and local code execution.

---

## Features

- **Single-File Build**: Compiles entire app (JS, CSS, Prism highlighting, KaTeX math fonts) into one portable `index.html`.
- **API Compatible**: Works with OpenAI, Ollama, OpenRouter, LocalAI, vLLM, LM Studio, and any OpenAI-compatible endpoint.
- **Client-Side RAG**:
  - File upload with background vector embedding and batch processing.
  - Cosine-similarity retrieval with customizable token limits and similarity thresholds.
  - Custom JavaScript hooks for chunking, context retrieval, deduplication, and chunk merging.
  - Import/export of chunk and vector datasets.
- **God Mode (JS Execution)**: Agentic feedback loop allowing models to output `<run>` blocks that execute directly in the browser and feed results back to the model.
- **Rich Rendering**: Markdown, KaTeX math typesetting (`$inline$`, `$$display$$`), and Prism.js syntax highlighting.
- **IndexedDB Storage**: Conversations, messages, files, vector embeddings, and preferences persist locally in your browser.

---

## Quick Start

### Running the pre-built file
Open `index.html` in any modern web browser. No server required.

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build single-file production bundle to ./index.html
npm run build

# Preview build
npm run preview
```

---

## Configuration

1. Click **Settings** in the sidebar.
2. Provide your **Base URL** (default: `https://api.openai.com/v1`) and **API Key**.
3. Specify available model names as a comma-separated list (e.g., `gpt-4o, gpt-4o-mini, llama3`).
4. (Optional) Set an **Embeddings Model** (e.g., `text-embedding-3-small`) in Super Secret Settings to enable vector search features.

---

## Shortcuts & Actions

### Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + Enter` / `Cmd + Enter` | Send message / Save edits |
| `Alt + T` | New chat |
| `Alt + W` | Delete current chat |
| `Alt + R` | Rename current chat |
| `Alt + P` | Toggle sidebar visibility |
| `Alt + O` | Toggle header visibility |
| `Alt + I` | Open Super Secret Settings |
| `Alt + Up` / `Alt + Down` | Switch active chat up / down |
| `Shift + Up` / `Shift + Down` | Scroll between message blocks |
| `Shift + Enter` (on Send) | Append user message without making an API call |

### Modifier Clicks

- **Ctrl / Cmd + Click on Code / Math**: Copy raw content directly to clipboard.
- **Ctrl / Cmd + Click on Chat Title**: Copy full chat transcript as Markdown.
- **Ctrl / Cmd + Click on File Item**: Open Advanced RAG Settings for that file.
- **Ctrl / Cmd + Click on Settings Header**: Open Super Secret Settings.
- **Alt + Click on File Item**: Replace file contents via file picker.
- **Alt + Click on Chat Item**: Export specific chat as JSON.
- **Alt + Click on "+ New"**: Import chats from JSON.

---

## Architecture

The codebase contains no external runtime frameworks and enforces unidirectional dependencies:

```
src/scripts/
├── core/       # Pure functions: formatting, tokens, pipeline, progress, vector math
├── data/       # IndexedDB repositories and storage keys
├── store/      # In-memory application state and event emitter
├── services/   # API clients, conversation loops, RAG, and execution engines
├── ui/         # DOM manipulation, components, views, and markdown rendering
└── app/        # Command registry, event delegation, shortcuts, and bootstrap
```


