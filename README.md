# HTML Chat

A lightweight, zero-runtime-dependency web chat client for OpenAI-compatible APIs that builds into a single self-contained `index.html` file. Includes local IndexedDB storage, client-side RAG exposed to the model as a file search tool, customizable JavaScript pipeline hooks, and in-browser JavaScript execution as a tool.

---

## Features

- **Single-File Build**: Compiles entire app (JS, CSS, Prism highlighting, KaTeX math fonts) into one portable `index.html`.
- **API Compatible**: Works with OpenAI, LiteLLM, Ollama, OpenRouter, LocalAI, vLLM, LM Studio, and any OpenAI-compatible endpoint. Models are discovered from the server's `/models` endpoint.
- **Thinking Box**: Everything the model does before its answer lives in one grey box at the top of the reply: its reasoning, the text it writes alongside tool calls, and the tool calls themselves. The header counts how long you have been waiting, across every reasoning step and tool run, until the answer starts. Models that expose their reasoning — through a `reasoning_content` / `reasoning` field, LiteLLM `thinking_blocks`, or inline `<think>...</think>` tags — stream it into the box; click it to expand. Boxes start collapsed by default (**Collapse Thinking** in Super Secret Settings). Once the turn is over the box gets its own Retry, Copy, Fork and Delete buttons, so a turn cut short by an error can be resumed from where it stopped.
- **Tool Calling**: JavaScript execution and file search are offered to the model as standard function-calling tools. Each call is a one-line row inside the thinking box, with its status and duration; click it to see the code it ran, its output, or the passages a search returned.
- **Reasoning With Tool Use**: When a model reasons between tool calls, that reasoning is kept across the whole tool loop. Signed Anthropic thinking blocks (Claude via LiteLLM) are sent back automatically, as Anthropic requires; plain-text reasoning can be echoed for models that expect it (**Echo Reasoning Field**). Reasoning is only ever sent back to the model that wrote it, and only within the turn in progress.
- **Client-Side RAG**:
  - File upload with background vector embedding and batch processing.
  - Attach files to a chat to let the model search them; cosine-similarity retrieval with customizable token limits and similarity thresholds.
  - Custom JavaScript hooks for chunking, context retrieval, deduplication, and chunk merging.
  - Import/export of chunk and vector datasets.
- **JavaScript Execution**: When enabled, the model can run code in the page and read back the return value, console output and errors, calling again as often as it needs within the tool round limit.
- **Rich Rendering**: Markdown, KaTeX math typesetting (`$inline$`, `$$display$$`), and Prism.js syntax highlighting.
- **IndexedDB Storage**: Conversations, messages, files, vector embeddings, and preferences persist locally in your browser. Chats saved by earlier versions are upgraded to the current format when they load.

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
3. (Optional) Ctrl+Click the model dropdown to choose a reasoning effort, sent as `reasoning_effort`.
4. (Optional) Set an **Embeddings Model** (e.g., `text-embedding-3-small`) in Super Secret Settings to enable file search, then click a file in **Your Files** to attach it to the current chat.
5. (Optional) Tick **Execute JavaScript** to offer the model the JavaScript tool.

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

- **Click on a Thinking box**: Expand or collapse the model's reasoning and tool calls (boxes with nothing in them have nothing to open).
- **Click on a tool call**: Expand or collapse its code and result.
- **Retry on a Thinking box**: Resume the turn from where it stopped, keeping everything the box already holds.
- **Click on a file**: Attach it to, or detach it from, the current chat.
- **Ctrl / Cmd + Click on Code / Math**: Copy raw content directly to clipboard.
- **Ctrl / Cmd + Click on Chat Title**: Copy full chat transcript as Markdown (reasoning excluded, tool calls included).
- **Ctrl / Cmd + Click on File Item**: Open Advanced RAG Settings for that file.
- **Ctrl / Cmd + Click on Settings Header**: Open Super Secret Settings.
- **Ctrl / Cmd + Click on the Model Dropdown**: Configure reasoning effort levels.
- **Alt + Click on File Item**: Replace file contents via file picker.
- **Alt + Click on Chat Item**: Export specific chat as JSON.
- **Alt + Click on "+ New"**: Import chats from JSON.

---

## Architecture

The codebase contains no external runtime frameworks and enforces unidirectional dependencies:

```
src/scripts/
├── core/       # Pure functions: formatting, tokens, roles, thinking, reasoning, tool calls, pipeline, progress, vector math
├── data/       # IndexedDB repositories and storage keys
├── store/      # In-memory application state and event emitter
├── services/   # API clients, conversation loops, RAG, and tool execution
├── ui/         # DOM manipulation, components, views, live timers, and markdown rendering
└── app/        # Command registry, event delegation, shortcuts, and bootstrap
```
