# HTML Chat

A lightweight, zero-runtime-dependency web chat client for OpenAI-compatible APIs that builds into a single self-contained `index.html` file. Includes local IndexedDB storage, client-side RAG exposed to the model as a file search tool, customizable JavaScript pipeline hooks, and in-browser JavaScript execution as a tool.

---

## Features

- **Single-File Build**: Compiles entire app (JS, CSS, Prism highlighting, KaTeX math fonts) into one portable `index.html`.
- **API Compatible**: Works with OpenAI, Ollama, OpenRouter, LocalAI, vLLM, LM Studio, and any OpenAI-compatible endpoint. Models are discovered from the server's `/models` endpoint.
- **Response Timer and Thinking Display**: Every message you send gets a box at the top of the reply that counts how long you have been waiting, from the moment the request goes out until the answer starts. Models that expose their reasoning — through a `reasoning_content` / `reasoning` field, or inline `<think>...</think>` tags — stream it into that box; click it to expand. Without reasoning the box simply reads "Responded after 1.2s". It is transcript-only: never sent back to the API and never counted towards the context estimate.
- **Tool Calling**: JavaScript execution and file search are offered to the model as standard function-calling tools. Every call the model makes in a row lands in one green **Tools** box that grows as the turn proceeds. Each call is a one-line row with its status and duration; click it to see the code it ran, its output, or the passages a search returned.
- **Client-Side RAG**:
  - File upload with background vector embedding and batch processing.
  - Attach files to a chat to let the model search them; cosine-similarity retrieval with customizable token limits and similarity thresholds.
  - Custom JavaScript hooks for chunking, context retrieval, deduplication, and chunk merging.
  - Import/export of chunk and vector datasets.
- **JavaScript Execution**: When enabled, the model can run code in the page and read back the return value, console output and errors, calling again as often as it needs within the tool round limit.
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

1. In the sidebar **Settings** box, provide your **Base URL** (default: `https://api.openai.com/v1`) and **API Key**, then click **Save**. Available models load from the server and appear in the dropdown beside **Send**.
2. For servers that do not implement `/models`, add model names under **Extra Models** in Super Secret Settings (comma-separated, e.g. `gpt-4o, llama3`).
3. (Optional) Set an **Embeddings Model** (e.g., `text-embedding-3-small`) in Super Secret Settings to enable file search, then click a file in **Your Files** to attach it to the current chat.
4. (Optional) Tick **Execute JavaScript** to offer the model the JavaScript tool.

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
| `Alt + D` | Toggle dark mode |
| `Alt + I` | Open Super Secret Settings |
| `Alt + Up` / `Alt + Down` | Switch active chat up / down |
| `Shift + Up` / `Shift + Down` | Scroll between message blocks |
| `Shift + Enter` (on Send) | Append user message without making an API call |

### Clicks

- **Click on a Thinking box**: Expand or collapse the model's reasoning (boxes without reasoning have nothing to open).
- **Click on a tool call**: Expand or collapse its code and result.
- **Click on a file**: Attach it to, or detach it from, the current chat.
- **Ctrl / Cmd + Click on Code / Math**: Copy raw content directly to clipboard.
- **Ctrl / Cmd + Click on Chat Title**: Copy full chat transcript as Markdown (thinking excluded, tool calls included).
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
├── core/       # Pure functions: formatting, tokens, roles, reasoning, tool calls, pipeline, progress, vector math
├── data/       # IndexedDB repositories and storage keys
├── store/      # In-memory application state and event emitter
├── services/   # API clients, conversation loops, RAG, and tool execution
├── ui/         # DOM manipulation, components, views, live timers, and markdown rendering
└── app/        # Command registry, event delegation, shortcuts, and bootstrap
```
