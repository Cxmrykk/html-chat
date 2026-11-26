# HTML Chat

A browser chat client for any OpenAI-compatible API, built into a single `index.html` file. It has no backend and no account. Everything, including your API key, is stored in your browser's IndexedDB.

Features:

- Streaming chat with reasoning display (`reasoning_content` / `reasoning` fields, inline `<think>` tags, LiteLLM `thinking_blocks`)
- Tool calling: JavaScript execution in the page
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

After clicking **Edit**, click the block (paragraph, list, code block, etc.) you want to change. Its source loads into the composer, and a dotted outline marks it. Shift+Click another block to select everything in between.

- Clicking another block switches the selection to it.
- Clicking the selected block again deselects it.
- **Save** (`Ctrl+Enter`) writes the edit back. An empty composer deletes the selected part.
- **Retry** saves the edit and regenerates from the message.

### Thinking boxes

Everything the model does before its answer is grouped into one collapsible box per turn: reasoning, text written alongside tool calls, and the tool calls with their results. The header shows how long you waited. Click any tool call to see its code and its result.

## Tools

### JavaScript execution

Tick **Execute JavaScript** to offer the model the `run_javascript` tool. The code runs **inside this page**, with full access to `window`, `document`, `fetch` and the app's own storage, which includes your API key. Only enable it with models and prompts you trust.

Calls run one at a time. Results are capped by **Max Tool Result Tokens**.

## Advanced settings

Open them with Ctrl+Click on the **Settings** heading, or `Alt+I`.

To change a setting, select it, edit the value in the bottom textarea, and save with **Save** or `Ctrl+Enter`. **Reset** restores one setting's default, and **Reset All** restores every default. Leaving a value blank uses the default.

| Setting                                                        | Default           | Notes                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temperature, Top P, Max Tokens, Frequency and Presence Penalty | API default       | Sent only when set                                                                                                                                           |
| Max Tool Rounds                                                | 10                | After this many rounds, the model must answer without tools                                                                                                  |
| Max Tool Result Tokens                                         | 4000              | Truncates JavaScript results. `0` disables the cap                                                                                                           |
| Echo Reasoning Field                                           | off               | `reasoning_content` or `reasoning`. Sends plain-text reasoning back during a tool loop, for models that need it. Signed thinking blocks are always sent back |
| JavaScript Tool Description                                    | built-in          | What the model is told about the JavaScript tool                                                                                                             |
| Extra Models                                                   | —                 | Comma-separated. Always added to the model dropdown                                                                                                          |
| Collapse Thinking                                              | true              | Whether new thinking boxes start closed                                                                                                                      |
| Auto-Collapse Code, Threshold, Preview Lines, Hint             | true, 20, 5, true | Long code blocks fold. Click to toggle                                                                                                                       |
| Max Visible Chats                                              | unlimited         | Limits sidebar list height                                                                                                                                   |

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
- All data lives in this browser's IndexedDB. Clearing site data deletes your chats and key. Use Export to back up chats.
- Token counts are estimates, at 4 characters per token.
- Earlier versions could search uploaded files. That feature has been removed: the files, profiles and vectors it stored are deleted on first load, and old search calls in chats are shown by name with their raw arguments.

## License

See [LICENSE](LICENSE).
