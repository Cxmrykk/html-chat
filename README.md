# HTML Chat

A browser chat client for any OpenAI-compatible API, built into a single `index.html` file. It has no backend and no account. Everything, including your API key, is stored in your browser's IndexedDB.

Features:

- Streaming chat with reasoning display (`reasoning_content` / `reasoning` fields, inline `<think>` tags, LiteLLM `thinking_blocks`)
- Tool calling: JavaScript execution in the page, and semantic search over your own files (RAG)
- Editing, retrying, forking and deleting any message, and changing its role
- Markdown, syntax highlighting and KaTeX math
- Import and export of chats and embedding vectors
- Light and dark themes, with keyboard-driven navigation

## Getting started

### Use the prebuilt file

Open `index.html` in a browser. That's it.

### Build from source

```sh
npm install
npm run dev      # dev server with hot reload
npm run build    # writes a self-contained index.html to the repo root
```

### Connect

1. In the sidebar, set **Base URL** (e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`) and **API Key**.
2. Models are fetched from `{Base URL}/models`. If your server doesn't implement that endpoint, add model ids under **Extra Models** (see [Advanced settings](#advanced-settings)).
3. Pick a model and type your prompt. `Ctrl+Enter` sends.

> The API server must allow cross-origin requests from the browser (CORS). Local servers often need this enabled explicitly.

## Chatting

| Action                                | How                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Send                                  | `Ctrl/Cmd+Enter` or **Send**                                                                                                    |
| Add a message without calling the API | `Ctrl+Shift+Enter`, or Shift+Click **Send**                                                                                     |
| Stop generation                       | Click the send button while it's running                                                                                        |
| Set reasoning effort                  | Ctrl+Click the model dropdown, then pick a level. The level list is editable, one per line. `none` sends no `reasoning_effort`. |

The **Send** button shows an estimate of the context size, at about 4 characters per token. It covers the full request, including tool definitions.

### Message actions

Hover a message to see its buttons:

- **Retry**
  - On a user message: resends it and discards everything after it.
  - On a thinking box: resumes the turn from that point.
- **Copy**: copies the message as markdown.
- **Edit**: edits part of the message (see below).
- **Fork**: creates a new chat containing everything up to and including this message.
- **Delete**: removes the message.
- **Role dropdown**: switches a message between `user`, `assistant` and `system`.

### Editing part of a message

After clicking **Edit**, click the block (paragraph, list, code block, etc.) you want to change. Its source loads into the composer, and a dotted outline marks it. Only one block is selected at a time.

- Clicking another block switches the selection to it.
- Clicking the selected block again deselects it.
- **Save** (`Ctrl+Enter`) writes the edit back. An empty composer deletes the selected block.
- **Retry** saves the edit and regenerates from the message.

### Thinking boxes

Everything the model does before its answer is grouped into one collapsible box per turn: reasoning, text written alongside tool calls, and the tool calls with their results. The header shows how long you waited. Click any tool call to see its code or query and its result.

## Tools

### JavaScript execution

Tick **Execute JavaScript** to offer the model the `run_javascript` tool. The code runs **inside this page**, with full access to `window`, `document`, `fetch` and the app's own storage, which includes your API key. Only enable it with models and prompts you trust.

Calls run one at a time. Results are capped by **Max Tool Result Tokens**.

### File search (RAG)

1. Set **Embeddings Model** in Advanced settings. File search is disabled without one.
2. Click **Upload** to add files. Indexing starts automatically in the background, with a progress bar and ETA.
3. Click a file's name to attach it to the current chat. Attached files are bold.

When a chat has files attached, the model gets a `search_files` tool:

- Your query is embedded and scored against every attached file's chunks by cosine similarity.
- The best matches from all files compete for one **Max RAG Tokens** budget.
- Each file's selected passages are put back in document order, merged and wrapped before being returned to the model.
- The model is told when a file isn't fully indexed yet.

File actions:

| Action                | How                 |
| --------------------- | ------------------- |
| Attach or detach      | Click the name      |
| Replace contents      | Alt+Click the name  |
| Per-file RAG settings | Ctrl+Click the file |

> Changing the embeddings model deletes **all** stored vectors, and every file must be re-indexed.

### Per-file RAG settings

Ctrl+Click a file to open its settings. The toolbar has:

- **Attempt Chunking**: runs the chunker and writes its output into _Custom Chunks_ so you can hand-edit it.
- **Start / Pause Embedding**
- **Export / Import Vectors**: a JSON file of chunks plus base64 vectors. Import requires the same embeddings model.

The per-file settings are:

| Setting                  | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| File Content Text        | Edit the stored file text directly                                       |
| File Wrapper Function    | Overrides the global wrapper for this file                               |
| Max RAG Tokens           | Cap on what this file can contribute to one search                       |
| RAG Match Threshold      | Minimum similarity, from 0 to 1                                          |
| Max Tokens Per Chunk     | Chunks larger than this are skipped when embedding                       |
| Custom Chunks (JSON)     | An array of strings or objects that bypasses the chunker entirely        |
| Custom Chunking Function | Default: 1000-character chunks with 200-character overlap                |
| Retrieval Function       | Step 1: process or expand each retrieved chunk. Return `null` to drop it |
| Deduplication Function   | Step 2: return `true` if `currentData` duplicates `existingData`         |
| Merge Chunks Function    | Step 3: combine the final chunks into one string                         |

All the functions above are bodies of async JavaScript functions. They must `return` a value. Available variables:

| Function      | Variables                     |
| ------------- | ----------------------------- |
| Chunker       | `fileContents`, `config`      |
| Retrieval     | `chunk`, `fileContents`       |
| Deduplication | `currentData`, `existingData` |
| Merge         | `finalChunks`                 |
| Wrapper       | `fileContent`, `fileName`     |

Chunks can be objects. Objects are JSON-stringified for embedding, and the original object is passed to your retrieval and merge functions.

## Advanced settings

Open them with Ctrl+Click on the **Settings** heading, or `Alt+I`.

To change a setting, select it, edit the value in the bottom textarea, and save with **Save** or `Ctrl+Enter`. **Reset** restores one setting's default, and **Reset All** restores every default. Leaving a value blank uses the default.

| Setting                                                        | Default                 | Notes                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temperature, Top P, Max Tokens, Frequency and Presence Penalty | API default             | Sent only when set                                                                                                                                           |
| Max Tool Rounds                                                | 10                      | After this many rounds, the model must answer without tools                                                                                                  |
| Max Tool Result Tokens                                         | 4000                    | Truncates JavaScript results. `0` disables the cap                                                                                                           |
| Echo Reasoning Field                                           | off                     | `reasoning_content` or `reasoning`. Sends plain-text reasoning back during a tool loop, for models that need it. Signed thinking blocks are always sent back |
| JavaScript and File Search Tool Descriptions                   | built-in                | What the model is told about each tool                                                                                                                       |
| Embeddings Base URL / API Key                                  | chat URL / key          | For a separate embeddings provider                                                                                                                           |
| Embeddings Model                                               | —                       | Required for file search                                                                                                                                     |
| Extra Models                                                   | —                       | Comma-separated. Always added to the model dropdown                                                                                                          |
| File Wrapper Function                                          | filename + fenced block | How each file's passages are presented to the model                                                                                                          |
| Max RAG Tokens                                                 | 5000                    | Total budget per search, across all files                                                                                                                    |
| RAG Match Threshold                                            | 0.0                     | Minimum similarity                                                                                                                                           |
| Max Tokens Per Chunk                                           | 1024                    |                                                                                                                                                              |
| Chunk Batch Size / Batch Max Tokens                            | 100 / 8192              | Per embeddings request                                                                                                                                       |
| Collapse Thinking                                              | true                    | Whether new thinking boxes start closed                                                                                                                      |
| Auto-Collapse Code, Threshold, Preview Lines, Hint             | true, 20, 5, true       | Long code blocks fold. Click to toggle                                                                                                                       |
| Max Visible Chats / Files                                      | unlimited               | Limits sidebar list height                                                                                                                                   |

## Keyboard and mouse

| Shortcut                             | Action                                              |
| ------------------------------------ | --------------------------------------------------- |
| `Alt+T`                              | New chat                                            |
| `Alt+W`                              | Delete current chat                                 |
| `Alt+R`                              | Rename current chat                                 |
| `Alt+↑` / `Alt+↓`                    | Previous / next chat                                |
| `Alt+P`                              | Toggle sidebar                                      |
| `Alt+O`                              | Toggle title                                        |
| `Alt+D`                              | Toggle dark mode                                    |
| `Alt+I`                              | Advanced settings                                   |
| `Shift+↑` / `Shift+↓`                | Jump between messages                               |
| `↑` / `↓`                            | Scroll the chat (outside text fields)               |
| Ctrl+Click code, inline code or math | Copy it. Math copies as LaTeX source                |
| Ctrl+Click a chat                    | Copy its transcript as markdown (without reasoning) |
| Alt+Click a chat                     | Export that chat as JSON                            |
| Alt+Click **New**                    | Import chats                                        |

**Import** and **Export** in the sidebar handle all chats as a single JSON file. Import skips chats whose id already exists.

## Notes

- Markdown output is **not sanitised**. HTML in model output renders as HTML.
- All data lives in this browser's IndexedDB. Clearing site data deletes your chats, files, vectors and key. Use Export to back up.
- Token counts are estimates, at 4 characters per token.

## License

See [LICENSE](LICENSE).
