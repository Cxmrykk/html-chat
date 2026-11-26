# HTML Chat

A browser chat client for any OpenAI-compatible API, built into a single `index.html` file. It has no backend and no account. Everything, including your API key, is stored in your browser's IndexedDB.

Features:

- Streaming chat with reasoning display (`reasoning_content` / `reasoning` fields, inline `<think>` tags, LiteLLM `thinking_blocks`)
- Model capabilities (tools, thinking and its levels, vision, context length) read from LiteLLM, Ollama and OpenAI-compatible `/models` responses
- Per-model LLM parameters (temperature, top P, ...) on top of shared defaults
- Tool calling: JavaScript execution in the page
- Editing, retrying, forking and deleting any message, and changing its role
- Markdown, syntax highlighting and KaTeX math
- Chat list grouped by date, import and export of chats
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

1. In the sidebar, set **Base URL** (e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`, `http://localhost:4000`) and **API Key**.
2. Models are fetched from `{Base URL}/models`. If your server doesn't implement that endpoint, add model ids under **Extra Models** (see [Advanced settings](#advanced-settings)).
3. Pick a model and type your prompt. `Ctrl+Enter` sends.

> The API server must allow cross-origin requests from the browser (CORS). Local servers often need this enabled explicitly.

### Model capabilities

The OpenAI spec doesn't say what a model can do, so after fetching `/models` the app also asks the server directly. These requests go to the Base URL with any trailing `/v1` removed:

| Server                       | Asked                                                    | Read                                                                                                             |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| LiteLLM                      | `GET /model/info`, falling back to `/model_group/info`   | `supports_function_calling`, `supports_reasoning`, `supports_vision`, `mode`, `max_input_tokens`, `supports_<level>_reasoning_effort` |
| Ollama                       | `GET /api/version`, then `POST /api/show` for each model | `capabilities` (`completion`, `tools`, `thinking`, `vision`) and the context length                              |
| Any OpenAI-compatible server | the `/models` response itself                            | `capabilities`, `supported_parameters` (OpenRouter), `supports_*` flags, context length, reasoning effort lists  |

What it changes:

- A model reported **without tool support** isn't offered tools.
- A model reported as **not a chat model** (an embedding model) isn't listed. Extra Models are always listed.
- **Thinking levels** come from the endpoint (see below).
- Hovering the model dropdown shows what the selected model supports, and which server reported it.

Anything not reported counts as unknown, and the app behaves as if there were no capability data. The official OpenAI API reports nothing, and the app doesn't probe `api.openai.com` or `openrouter.ai`. You can turn probing off with **Probe Capabilities**.

## Chatting

| Action                                | How                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Send                                  | `Ctrl/Cmd+Enter` or **Send**                                             |
| Add a message without calling the API | `Ctrl+Shift+Enter`, or Shift+Click **Send**                              |
| Stop generation                       | Click the send button while it's running                                 |
| Set reasoning effort                  | Ctrl+Click the model dropdown, then pick a level (see below)             |

The **Send** button shows an estimate of the context size, at about 4 characters per token. It covers the full request, including tool definitions.

The chat list in the sidebar always fills the height left below the settings box, and scrolls on its own. Chats are grouped under date headings (Today, Yesterday, Previous 7 Days, Previous 30 Days, then by month) according to when each chat was created. Turn this off with **Chat Date Groups**.

### Reasoning effort

Ctrl+Click the model dropdown to choose the `reasoning_effort` sent with each request. The levels depend on what the endpoint reported for the selected model:

- **Levels reported** (LiteLLM, Ollama, or a `/models` entry that lists them): you get `default` and then those levels. `default` sends nothing and leaves the choice to the server. A reported `none` is sent, and asks the model not to think.
  - LiteLLM: `low`, `medium` and `high` for reasoning models, plus `none`, `minimal` or `xhigh` where LiteLLM's model map flags them.
  - Ollama: gpt-oss takes `low`, `medium` and `high`, and can't be switched off. Other thinking models are only on or off, so they get `none` and `high`.
- **Reported as not thinking**: only `default`.
- **Nothing reported**: your own list, one level per line, edited in the textarea. Here `none` sends nothing.

The chosen level is kept across models. If a model doesn't take it, nothing is sent for that model.

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

After clicking **Edit**, click the block (paragraph, list, code block, etc.) you want to change. Its source loads into the composer, and a dotted outline marks it. Shift+Click another block to select everything in between, or click **Select All** to select every block of the message at once.

- Clicking another block switches the selection to it.
- Clicking the selected block again deselects it.
- **Save** (`Ctrl+Enter`) writes the edit back. An empty composer deletes the selected part.
- **Cancel** ends the edit without saving.
- **Toggle Wrap** switches line wrapping in the composer.

To regenerate from an edited message, save it, then use **Retry** on it.

### Thinking boxes

Everything the model does before its answer is grouped into one collapsible box per turn: reasoning, text written alongside tool calls, and the tool calls with their results. The header shows how long you waited. Click any tool call to see its code and its result.

## Tools

### JavaScript execution

Tick **Execute JavaScript** to offer the model the `run_javascript` tool. The code runs **inside this page**, with full access to `window`, `document`, `fetch` and the app's own storage, which includes your API key. Only enable it with models and prompts you trust.

Calls run one at a time. Results are capped by **Max Tool Result Tokens**. The tool isn't offered to a model whose endpoint reports it can't call tools.

## Advanced settings

Open them by clicking the **Settings** heading in the sidebar, or with `Alt+I`. Click it again to close them.

To change a setting, select it, edit the value in the bottom textarea, and save with **Save** or `Ctrl+Enter`. **Reset** restores one setting's default, **Cancel** discards your edit, and **Reset All** restores every default. Leaving a value blank uses the default. While a setting is being edited, **Close** is grayed out, so it can't be clicked by mistake instead of Save, Reset or Cancel.

### Per-model parameters

The **Parameters for** dropdown at the top of the settings picks whose LLM parameters you are editing (Temperature, Top P, Max Tokens, Frequency and Presence Penalty):

- **All models (defaults)**: every setting is shown. The LLM parameters set here apply to every model that doesn't override them.
- **A model**: only the LLM parameters are shown, and what you set applies to that model alone.
  - A blank value inherits the default, shown as `Inherit (...)`.
  - `none` sends nothing for that model, even if a default is set. Use this for models that reject a parameter.
  - **Reset** removes one override, and **Reset All** removes all of that model's overrides.
  - Models with overrides are marked `(custom)` in the dropdown.

Reset All with no model selected restores the defaults and keeps every model's overrides.

| Setting                                                        | Default           | Notes                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Temperature, Top P, Max Tokens, Frequency and Presence Penalty | API default       | Sent only when set. Can be overridden per model                                                                                                              |
| Max Tool Rounds                                                | 10                | After this many rounds, the model must answer without tools                                                                                                  |
| Max Tool Result Tokens                                         | 4000              | Truncates JavaScript results. `0` disables the cap                                                                                                           |
| Echo Reasoning Field                                           | off               | `reasoning_content` or `reasoning`. Sends plain-text reasoning back during a tool loop, for models that need it. Signed thinking blocks are always sent back |
| JavaScript Tool Description                                    | built-in          | What the model is told about the JavaScript tool                                                                                                             |
| Extra Models                                                   | —                 | Comma-separated. Always added to the model dropdown                                                                                                          |
| Probe Capabilities                                             | true              | Ask LiteLLM and Ollama what each model supports. Changing it fetches the model list again                                                                   |
| Image Cache (MB)                                               | 100               | Browser storage for original images, so they survive a reload. `0` keeps them in memory only                                                                |
| Placeholder Width, Placeholder Max Pixels                      | 64, 4096          | Size of the pixelated placeholder a chat stores for each image                                                                                              |
| Chat Date Groups                                               | true              | Group the sidebar's chat list under date headings                                                                                                            |
| Collapse Thinking                                              | true              | Whether new thinking boxes start closed                                                                                                                      |
| Auto-Collapse Code, Threshold, Preview Lines, Hint             | true, 20, 5, true | Long code blocks fold. Click to toggle                                                                                                                       |

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
- Ollama reports the context length a model was trained with, which can be larger than the context it actually runs with (`num_ctx`).
- Chat date groups go by when a chat was created, not when it was last used.
- Earlier versions could search uploaded files. That feature has been removed: the files, profiles and vectors it stored are deleted on first load, and old search calls in chats are shown by name with their raw arguments.
- Earlier versions had a **Max Visible Chats** setting. The chat list now always fills the sidebar, so the setting is gone and its stored value is deleted on load.

## License

See [LICENSE](LICENSE).
