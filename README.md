# HTML Chat

A browser chat client for any OpenAI-compatible API, built into a single `index.html` file. It has no backend and no account. Everything, including your API key, is stored in your browser's IndexedDB.

Features:

- Streaming chat with reasoning display (`reasoning_content` / `reasoning` fields, inline `<think>` tags, LiteLLM `thinking_blocks`)
- Tool calling: JavaScript execution in the page, and search over your own files by text, regular expression and embeddings
- A file search configurator, with an optional LLM assistant that sets it up from a sample of the file
- Editing, retrying, forking and deleting any message, and changing its role
- Markdown, syntax highlighting and KaTeX math
- Import and export of chats
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

### File search

Uploaded files are searched according to a **search profile**: a named, reusable description of how one kind of document is searched. A file without a profile shows a caution sign, cannot be attached to a chat, and is not indexed.

1. Click **Upload**. The configurator opens for the new file (files uploaded together are configured one after another).
2. Pick an existing profile, or create one, and save it.
3. Click the file's name to attach it to the current chat. Attached files are bold.

Each search method a profile enables becomes a tool for the model:

| Method     | Tool              | Finds                                                                     |
| ---------- | ----------------- | ------------------------------------------------------------------------- |
| Text       | `search_text`     | Sections containing a phrase, literally and case-insensitively            |
| Regex      | `search_regex`    | Sections matching a JavaScript regular expression                         |
| Embeddings | `search_semantic` | Sections similar in meaning to a query (needs an **Embeddings Model**)    |

A tool is offered only when at least one attached file enables its method, and it lists only those files, with the notes of their profile. Each tool's description also points the model at the other search tools available in the chat.

#### How results are built

A profile's **parser** splits the document into **sections**, each with a **path**: its place in the document hierarchy, such as `Installation › Linux`. Search results are whole sections, labelled with their path and line numbers. A section longer than the profile's maximum size is shown as an excerpt around the match, and is embedded in pieces.

- Text and regex rank sections by how many matches they hold. Embeddings rank them by similarity.
- The best candidates from all files compete for one **Max RAG Tokens** budget.
- A profile can add neighbouring sections, and the first lines of the file (a CSV header row, say), to every result.
- Each file's results are put back in document order and merged where they touch.
- The model is told when a file isn't fully indexed yet, or when its parser failed.

#### The configurator

Open it by clicking a file with a caution sign (its name or the sign), or by Ctrl+Clicking any file.

1. **Profile**: use an existing profile as it is, start from one, or create a new one. Profiles claiming the file's extension are listed first.
2. **Methods**: tick the search methods. At least one is required.
3. **Structure**: choose a parser and its options. A live outline of the file shows every section, its size, and warnings such as oversized sections or a file that did not split at all.
4. **Output**: breadcrumbs, neighbouring sections, header lines, the similarity threshold, and **notes for the chat model**, which are added to the tool description. A test box runs a text or regex search on the file and shows exactly what the model would receive.
5. **Save**: name the profile and list the extensions it suits. Saving can also apply it to the other unconfigured files with those extensions. When editing an existing profile, **Update** changes it for every file that uses it (they are re-indexed), and **Save as a new profile** leaves them alone.

Parser presets:

| Preset              | Sections                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| Markdown headings   | One per heading; the path is the chain of headings above it                    |
| XML / HTML elements | One per element (named ones, or all down to a depth); labelled by id/name/title |
| Paragraphs          | Paragraphs after blank lines, grouped up to a minimum size                     |
| Lines               | Runs of N lines: records in CSV, TSV, logs, JSON Lines                         |
| Fixed size          | Roughly equal lengths, cut at line breaks                                      |
| Custom code         | Your own JavaScript (see below)                                                |

A custom parser is the body of an async JavaScript function. It receives `text` (the whole file) and `fileName`, and returns an array of boundaries, `{ start, path }`. `start` is the character offset at which a section begins, and `path` is an array of strings. A section runs until the next boundary, and text before the first boundary becomes an untitled preamble. The code runs in this page.

#### The assistant

From the Structure step on, an assistant can configure the profile for you. It uses the model selected for chatting, with a hard-coded prompt, statistics about the whole file, and a sample of it (the whole file if it is small; otherwise its start, middle and end).

- **Generate configuration** asks it to fill in everything except the search methods, which stay as you chose them.
- The box under the configurator (`Ctrl+Enter`) asks it for changes, in conversation.
- Before showing you a configuration, the app runs its parser on the whole file. If the configuration fails to parse or splits the file badly, the problems are sent back to the model automatically, up to three attempts in all.
- Its changes go into the draft and the outline. Nothing is saved until you save.

> Changing the embeddings model deletes **all** stored vectors, and every file that uses embeddings is re-indexed.

## Advanced settings

Open them with Ctrl+Click on the **Settings** heading, or `Alt+I`.

To change a setting, select it, edit the value in the bottom textarea, and save with **Save** or `Ctrl+Enter`. **Reset** restores one setting's default, and **Reset All** restores every default. Leaving a value blank uses the default.

| Setting                                                        | Default           | Notes                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temperature, Top P, Max Tokens, Frequency and Presence Penalty | API default       | Sent only when set                                                                                                                                           |
| Max Tool Rounds                                                | 10                | After this many rounds, the model must answer without tools                                                                                                  |
| Max Tool Result Tokens                                         | 4000              | Truncates JavaScript results. `0` disables the cap                                                                                                           |
| Echo Reasoning Field                                           | off               | `reasoning_content` or `reasoning`. Sends plain-text reasoning back during a tool loop, for models that need it. Signed thinking blocks are always sent back |
| JavaScript, Text, Regex and Semantic Search Tool Descriptions  | built-in          | What the model is told about each tool. For search tools, the result format, hints and file list are appended                                               |
| Embeddings Base URL / API Key                                  | chat URL / key    | For a separate embeddings provider                                                                                                                           |
| Embeddings Model                                               | —                 | Required for semantic search                                                                                                                                 |
| Extra Models                                                   | —                 | Comma-separated. Always added to the model dropdown                                                                                                          |
| Max RAG Tokens                                                 | 5000              | Total budget per search, across all files                                                                                                                    |
| Embedding Batch Size / Batch Max Tokens                        | 100 / 8192        | Per embeddings request                                                                                                                                       |
| Collapse Thinking                                              | true              | Whether new thinking boxes start closed                                                                                                                      |
| Auto-Collapse Code, Threshold, Preview Lines, Hint             | true, 20, 5, true | Long code blocks fold. Click to toggle                                                                                                                       |
| Max Visible Chats / Files                                      | unlimited         | Limits sidebar list height                                                                                                                                   |

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
| Click a file                         | Attach or detach it (configure it first if needed)  |
| Ctrl+Click a file                    | Change how it is searched                           |
| Alt+Click a file                     | Replace its contents                                |

**Import** and **Export** in the sidebar handle all chats as a single JSON file. Import skips chats whose id already exists.

## Notes

- Markdown output is **not sanitised**. HTML in model output renders as HTML.
- All data lives in this browser's IndexedDB. Clearing site data deletes your chats, files, profiles, vectors and key. Use Export to back up chats.
- Token counts are estimates, at 4 characters per token.
- Files uploaded before search profiles existed come up unconfigured: their old chunks overlapped, which sections cannot, so they are set up again like new uploads.

## License

See [LICENSE](LICENSE).
