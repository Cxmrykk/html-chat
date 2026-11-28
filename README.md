# HTML Chat

A browser chat client for any OpenAI-compatible API, built into a single `index.html`. No backend, no account. Everything, including your API key, is stored in your browser's IndexedDB.

Features:

- Streaming chat with reasoning display (`reasoning_content` / `reasoning` fields, inline `<think>` tags, LiteLLM `thinking_blocks`)
- Model capabilities (tools, thinking levels, vision, context length) read from LiteLLM, Ollama and `/models`
- Per-model LLM parameters on top of shared defaults
- Image attachments, and image generation and editing as tools
- Tool calling: JavaScript execution in the page
- Edit, retry, fork and delete any message, or change its role
- Markdown, syntax highlighting and KaTeX math
- Chat list grouped by date, import and export
- Light and dark themes, keyboard navigation

## Getting started

Open `index.html` in a browser. That's it.

To build from source:

```sh
npm install
npm run dev      # dev server with hot reload
npm run build    # writes a self-contained index.html to the repo root
```

To connect:

1. Set **Base URL** (e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`, `http://localhost:4000`) and **API Key** in the sidebar.
2. Models are fetched from `{Base URL}/models`. If your server doesn't implement it, add ids under **Extra Models**.
3. Pick a model, type, and press `Ctrl+Enter`.

> The server must allow cross-origin requests (CORS).

### Model capabilities

After fetching `/models`, the app asks the server what each model supports. Requests go to the Base URL with any trailing `/v1` removed.

| Server  | Asked                                                    | Read                                                                                                          |
| ------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| LiteLLM | `GET /model/info`, falling back to `/model_group/info`   | `supports_function_calling`, `supports_reasoning`, `supports_vision`, `mode`, `max_input_tokens`, effort flags |
| Ollama  | `GET /api/version`, then `POST /api/show` per model      | `capabilities` and context length                                                                             |
| Any     | the `/models` response                                   | `capabilities`, `supported_parameters`, `supports_*` flags, context length, effort lists                      |

- Models reported without tool support aren't offered tools.
- Models reported as not chatting (embedding or image-only models) are left out of the dropdown.
- Unreported capabilities count as unknown, and the app behaves as if there were no data. `api.openai.com` and `openrouter.ai` aren't probed.
- **Image models are never detected.** Identify them by hand (see [Images](#images)).

Turn probing off with **Probe Capabilities**.

## Chatting

| Action                         | How                                         |
| ------------------------------ | ------------------------------------------- |
| Send                           | `Ctrl/Cmd+Enter` or **Send**                |
| Add a message without the API  | `Ctrl+Shift+Enter`, or Shift+Click **Send** |
| Stop                           | Click the send button while it's running    |
| Set reasoning effort           | Ctrl+Click the model dropdown               |

**Send** shows an estimated context size (4 characters per token), including tool definitions.

The chat is for text models only. Image models never appear in the model dropdown. They are used through the image tools (see [Images](#images)).

### Reasoning effort

The levels depend on what the endpoint reported for the selected model:

- **Levels reported**: `default` (sends nothing), then the reported levels. A reported `none` is sent and turns thinking off.
- **Reported as not thinking**: `default` only.
- **Nothing reported**: your own list, one level per line. Here `none` sends nothing.

A level the selected model doesn't take isn't sent.

### Message actions

- **Retry**: on a user message, resends it and drops everything after it. On a thinking box, resumes the turn.
- **Copy**: copies the message as markdown.
- **Edit**: edits part of the message.
- **Fork**: opens a new chat with everything up to this message.
- **Delete**: removes the message.
- **Role dropdown**: switches between `user`, `assistant` and `system`.

### Editing

After **Edit**, click a block (paragraph, list, code block) to load it into the composer.

- Shift+Click another block to select the range; **Select All** selects every block.
- Clicking the selected block again deselects it.
- **Save** (`Ctrl+Enter`) writes the edit back. An empty composer deletes the selection.
- Paste or drop images to add them to the message. Use the corner buttons on an image to move or remove it, or click it to replace it.

### Thinking boxes

Each turn's reasoning, the text written alongside tool calls, and the tool calls with their results sit in one collapsible box. Its header shows how long you waited.

### Chat list

Chats are grouped by creation date: Today, Yesterday, one heading per day for the last 30 days, then Older. Click a heading to collapse its group. Turn this off with **Chat Date Groups**.

## Images

### Attachments

Paste or drop images into the chat. A chat only stores a small pixelated placeholder of each image. Originals are kept in memory and, up to **Image Cache (MB)**, in browser storage.

If an original is gone, its tag turns red. Click the placeholder to restore it from the file. If you send anyway, you're warned first, and the placeholder is sent scaled up.

**Vision Max Pixels** (default `4194304`, 2048×2048) scales down images sent to chat models.

> The pixel limits only apply to the copy of an image sent to the API. The image stored locally stays at full size.

### Image models

1. Open the advanced settings, then **Image Generation → Identify Image Models**.
2. Click models to mark them as image models. Requests to image models go to `/images/generations` and `/images/edits`, not chat completions.
3. Tick **Image Manipulation** in the sidebar (shown once an image model is identified). The chat model gets `list_image_models`, `generate_image` and `edit_image`, and can use every image model except those you switch off under **Toggle Image Models**.

Image models are only used through these tools. They never appear in the model dropdown.

Images sent for editing are scaled down to **Edit Max Pixels** (default `4194304`, 2048×2048) using **Edit Scaling Method**. With **Send Generated Images** on, generated images are sent back to the model so it can check them.

## Tools

### Code execution

Tick **Code Execution** to offer the model `run_javascript`. The code runs **inside this page**, with full access to `window`, `document`, `fetch` and the app's storage, including your API key. Only enable it with models and prompts you trust.

Calls run one at a time. Results are capped by **Max Tool Result Tokens**.

## Advanced settings

Open them by clicking the **Settings** heading or pressing `Alt+I`. Select a setting, edit it in the bottom textarea, and save with **Save** or `Ctrl+Enter`. Dropdown settings save as soon as you pick. A blank value uses the default.

- **Reset** restores one setting.
- **Reset All** restores every setting. It keeps per-model overrides and identified image models.

### Quick Actions

The cards at the top of the advanced settings run as soon as you click them:

- **Import Chats**: loads chats from a JSON export. Chats whose id already exists are skipped.
- **Export Chats**: downloads every chat as one JSON file.

### Per-model parameters

The **Model** row at the top of LLM Behavior picks whose parameters you're editing:

- **All models (defaults)**: values apply to every model without an override.
- **A model**: values apply to that model only.
  - A blank value inherits the default.
  - `none` sends nothing for that model.
  - Models with overrides are marked `(custom)`.

### Settings

| Setting                                                         | Default           | Notes                                                                    |
| --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| Temperature, Top P, Max Tokens, Frequency and Presence Penalty  | API default       | Sent only when set. Per-model                                            |
| Max Tool Rounds                                                 | 10                | After this, the model must answer without tools                          |
| Max Tool Result Tokens                                          | 4000              | `0` disables the cap                                                     |
| Echo Reasoning Field                                            | off               | `reasoning_content` or `reasoning`, sent back during tool loops          |
| Retry Keeps Thinking                                            | true              | A resumed turn carries the reasoning shown so far                        |
| JavaScript Tool Description                                     | built-in          | What the model is told about the tool                                    |
| Extra Models                                                    | —                 | Comma-separated, always listed                                           |
| Probe Capabilities                                              | true              | Ask LiteLLM and Ollama what each model supports                          |
| Image Cache (MB)                                                | 100               | `0` keeps originals in memory only                                       |
| Placeholder Width, Placeholder Max Pixels                       | 64, 4096          | Size of the stored placeholder                                           |
| Vision Max Pixels, Vision Scaling Method                        | 4194304, high     | Scales images sent to chat models. `0` sends full size                   |
| Identify Image Models, Toggle Image Models                      | none, all         | Pages for marking image models and which ones the tools may use          |
| Send Generated Images                                           | false             | Send generated images back to the model                                  |
| Edit Max Pixels, Edit Scaling Method                            | 4194304, high     | Scales images sent for editing. `0` sends full size                      |
| Chat Date Groups                                                | true              | Group the chat list by date                                              |
| Collapse Thinking                                               | true              | New thinking boxes start closed                                          |
| Auto-Collapse Code, Threshold, Preview Lines, Hint              | true, 20, 5, true | Long code blocks fold                                                    |

Scaling methods: smooth (high, medium or low quality), progressive halving, or nearest neighbour. Only the copy sent to the API is scaled; the stored image stays at full size.

## Keyboard and mouse

| Shortcut                             | Action                               |
| ------------------------------------ | ------------------------------------ |
| `Alt+T` / `Alt+W` / `Alt+R`          | New / delete / rename chat           |
| `Alt+↑` / `Alt+↓`                    | Previous / next chat                 |
| `Alt+P` / `Alt+O` / `Alt+D`          | Toggle sidebar / title / dark mode   |
| `Alt+I`                              | Advanced settings                    |
| `Shift+↑` / `Shift+↓`                | Jump between messages                |
| `↑` / `↓`                            | Scroll the chat (outside text fields)|
| Ctrl+Click code, inline code or math | Copy it (math as LaTeX)              |
| Ctrl+Click a chat                    | Copy its transcript as markdown      |
| Alt+Click a chat                     | Export it as JSON                    |
| Alt+Click **New**                    | Import chats                         |
| Pinch or Ctrl+Scroll an image        | Zoom                                 |

## Notes

- Markdown output is **not sanitised**: HTML in model output renders as HTML.
- Clearing site data deletes your chats and key. Export to back up.
- Ollama reports the trained context length, which may exceed `num_ctx`.
- Image models used to be detected automatically. They now have to be identified once by hand.
- Chatting directly with image models has been removed, along with the **Image Models in Chat** and **Image Parameters** settings. Images from earlier chats with them are still shown.
- Old file-search data is deleted on load. Old search calls in chats are shown by name with their raw arguments.

## License

See [LICENSE](LICENSE).
