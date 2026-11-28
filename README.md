# HTML Chat

A browser chat client for any OpenAI-compatible API, built into a single `index.html`. No backend, no account. Everything, including your API key, is stored in your browser's IndexedDB.

Features:

- Streaming chat with reasoning display (`reasoning_content` / `reasoning` fields, inline `<think>` tags, LiteLLM `thinking_blocks`)
- Model capabilities (tools, thinking levels, vision, context length) read from LiteLLM, Ollama and `/models`
- A model blacklist or whitelist for the dropdown
- Per-model LLM parameters on top of shared defaults
- Image attachments, and image generation and editing as tools, with lossless auto-cropping to the requested size
- Tool calling: JavaScript execution in the page
- Edit, retry, fork and delete any message, or change its role
- Markdown, syntax highlighting and KaTeX math
- Chat list grouped by date, with a page to search every chat (text, wildcard or regex)
- Named chats, kept by automatic purging of old chats
- Import and export of one chat, all chats, or the settings
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

### Filtering models

Under **API & Connections**, **Model Filter Mode** picks a blacklist (the default) or a whitelist, and **Filter Models** opens the list of text models to click on or off:

- **Blacklist**: the models marked *Hidden* are left out of the dropdown.
- **Whitelist**: only the models marked *Shown* are offered. With none marked, no model is offered.

A model the filter hides can't be sent to.

## Chatting

| Action                         | How                                         |
| ------------------------------ | ------------------------------------------- |
| Send                           | `Ctrl/Cmd+Enter` or **Send**                |
| Attach images                  | The paperclip button, or paste or drop them |
| Add a message without the API  | `Ctrl+Shift+Enter`, or Shift+Click **Send** |
| Stop                           | Click the send button while it's running    |
| Set reasoning effort           | Ctrl+Click the model dropdown               |

While a turn runs, the send button reads **Thinking...**, **Generating...** or **Executing...** (a tool is running), and the paperclip button is hidden.

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
- Use the paperclip button left of **Save**, or paste or drop images, to add them to the message. The corner buttons on each image move, replace or remove it.

### Thinking boxes

Each turn's reasoning, the text written alongside tool calls, and the tool calls with their results sit in one collapsible box. Its header shows how long you waited. A tool call can be opened while the model is still writing it, to watch it arrive.

## Chats

In the sidebar, a chat without a name shows its estimated size (4 characters per token, as it would be sent) and how many images go with it, e.g. `1.2k tokens + 5`. A named chat shows its name. Hover any chat for the exact counts and how it began.

Token counts are shortened to save space: the raw number below 1,000, then one decimal below 100 of a unit (dropped when it's `.0`) and none from 100 up: `999`, `1k`, `1.1k`, `12.3k`, `100k`, `1M`, `12.5M`, `250M`.

The `+ N` counts the images sent as image parts: every image you attached, each time a message carries it, plus, with **Send Generated Images** on, every image the model made, once each.

Chats are grouped by creation date: Today, Yesterday, one heading per day for the last 30 days, then Older. Click a heading to collapse its group. Turn this off with **Chat Date Groups**.

### Naming chats

Click the pencil beside a chat (or press `Alt+R`) to name it. A named chat:

- shows its name in the sidebar instead of its counts;
- is never deleted by Auto-Purge or Reset Chats;
- asks for confirmation before you delete it yourself.

Clear the name to undo all of this.

### The chats page

Click **Your Chats** to open it. It holds:

| Card                | Does                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| Export Current Chat | Downloads the open chat as JSON                                                        |
| Export All Chats    | Downloads every chat as one JSON file                                                  |
| Import Chats        | Reads either export. Chats whose id already exists are skipped                         |
| Reset Chats         | Deletes every chat that has no name, after a confirmation                              |
| Auto-Purge          | Shows the current setting; click to open the settings                                  |

Below them, every chat, grouped by date. Type in the bottom box to search all of them, reasoning and tool calls included:

- **Contains**: plain text.
- **Wildcard**: `*` matches any run of characters and `?` any one character, within a line.
- **Regex**: a JavaScript regular expression, bare or as `/pattern/flags`.

**Case** switches case-sensitive matching. Each result shows its match count and the first match in context; clicking it opens the chat at that message.

> A regular expression runs on your own machine. A pathological one (catastrophic backtracking) can freeze the page.

### Auto-Purge

**Auto-Purge Days** (under *Chats* in the settings, default `0`, off) deletes chats unchanged for longer than that many days, on load and every hour. Named chats and the open chat are kept. Setting a value that would delete chats right away asks first; cancelling restores the previous value.

## Images

### Attachments

Attach images with the paperclip button, or paste or drop them into the chat. A chat only stores a small pixelated placeholder of each image. Originals are kept in memory and, up to **Image Cache (MB)**, in browser storage.

A message's images sit in an **Attachments** drop-down, two to a row, each shown whole. Click one to open it across the whole drop-down: it fills the width, a tall image scrolls vertically, and the buttons stay put over it:

- **X** (top left, or `Esc`) closes it.
- **Download** and **Copy** (top right) save the original, or copy it to the clipboard as PNG.

If an original is gone, its tag turns red, and the opened image offers **Restore** instead: pick the original file to bring it back. If you send anyway, you're warned first, and the placeholder is sent scaled up.

**Vision Max Pixels** (default `4194304`, 2048×2048) scales down images sent to chat models.

> The pixel limits only apply to the copy of an image sent to the API. The image stored locally stays at full size.

### Image models

1. Open the advanced settings, then **Image Generation → Identify Image Models**.
2. Click models to mark them as image models. Requests to image models go to `/images/generations` and `/images/edits`, not chat completions.
3. Tick **Image Manipulation** in the sidebar (shown once an image model is identified). The chat model gets `list_image_models`, `generate_image` and `edit_image`, and can use every image model except those you switch off under **Toggle Image Models**.

Image models are only used through these tools. They never appear in the model dropdown.

When a turn generates or edits images, the assistant's answer ends with an **Attachments** drop-down holding them, opened, so they show without opening the thinking box.

Images sent for editing are scaled down to **Edit Max Pixels** (default `4194304`, 2048×2048) using **Edit Scaling Method**. With **Send Generated Images** on, generated images are sent back to the model, once each, so it can check them.

### Auto-crop

When a call asks for a size (e.g. `1024x1024`) and the image model returns a slightly larger image, **Auto-Crop Generated Images** (on by default) crops it from the top-left corner to the requested size. The pixels are copied one to one and saved as PNG, so nothing is lost. It applies when the image is no smaller in either dimension and has at most **Auto-Crop Tolerance** (default 5%) more pixels than requested.

A larger image, one smaller in either dimension (it can't be enlarged without distorting it), or any mismatch with auto-crop off is left as it is. In every case the tool result tells the model what it got.

## Tools

### Code execution

Tick **Code Execution** to offer the model `run_javascript`. The code runs **inside this page**, with full access to `window`, `document`, `fetch` and the app's storage, including your API key. Only enable it with models and prompts you trust.

Calls run one at a time. Results are capped by **Max Tool Result Tokens**.

## Advanced settings

Open them by clicking the **Settings** heading or pressing `Alt+I`. Select a setting, edit it in the bottom textarea, and save with **Save** or `Ctrl+Enter`. On/Off settings flip with a click, and dropdown settings save as soon as you pick. A blank value uses the default. **Reset** restores one setting.

### Quick Actions

| Card               | Does                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Export Settings    | Downloads every setting, per-model override, image model selection and the model filter. The API key is left out |
| Import Settings    | Replaces the current settings after a confirmation, keeping your API key                     |
| Reset All Settings | Restores every setting to its default, keeping per-model overrides, identified image models and the model filter list. With a model picked in LLM Behavior, removes only that model's overrides |

Chat import and export live on the [chats page](#the-chats-page).

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
| Max Tool Rounds                                                 | 25                | After this, the model must answer without tools                          |
| Max Tool Result Tokens                                          | 4000              | `0` disables the cap                                                     |
| Echo Reasoning Field                                            | off               | `reasoning_content` or `reasoning`, sent back during tool loops          |
| Retry Keeps Thinking                                            | on                | A resumed turn carries the reasoning shown so far                        |
| JavaScript Tool Description                                     | built-in          | What the model is told about the tool                                    |
| Extra Models                                                    | —                 | Comma-separated, always listed                                           |
| Probe Capabilities                                              | on                | Ask LiteLLM and Ollama what each model supports                          |
| Model Filter Mode, Filter Models                                | blacklist, none   | Hide listed models, or show only them                                    |
| Image Cache (MB)                                                | 100               | `0` keeps originals in memory only                                       |
| Placeholder Width, Placeholder Max Pixels                       | 64, 4096          | Size of the stored placeholder                                           |
| Vision Max Pixels, Vision Scaling Method                        | 4194304, high     | Scales images sent to chat models. `0` sends full size                   |
| Identify Image Models, Toggle Image Models                      | none, all         | Pages for marking image models and which ones the tools may use          |
| Send Generated Images                                           | off               | Send generated images back to the model; counted in each chat's `+ N`    |
| Edit Max Pixels, Edit Scaling Method                            | 4194304, high     | Scales images sent for editing. `0` sends full size                      |
| Auto-Crop Generated Images, Auto-Crop Tolerance (%)             | on, 5             | Crop slightly oversized generated images to the requested size           |
| Auto-Purge Days                                                 | 0 (off)           | Delete chats unchanged for longer. Named chats are kept                  |
| Chat Date Groups                                                | on                | Group the chat list by date                                              |
| Collapse Thinking                                               | on                | New thinking boxes start closed                                          |
| Auto-Collapse Code, Threshold, Preview Lines, Hint              | on, 20, 5, on     | Long code blocks fold                                                    |

Scaling methods: smooth (high, medium or low quality), progressive halving, or nearest neighbour. Only the copy sent to the API is scaled; the stored image stays at full size.

## Keyboard and mouse

| Shortcut                             | Action                               |
| ------------------------------------ | ------------------------------------ |
| `Alt+T` / `Alt+W` / `Alt+R`          | New / delete / name chat             |
| `Alt+↑` / `Alt+↓`                    | Previous / next chat                 |
| `Alt+P` / `Alt+O` / `Alt+D`          | Toggle sidebar / title / dark mode   |
| `Alt+I`                              | Advanced settings                    |
| `Esc`                                | Close an opened image                |
| Click **Your Chats**                 | Search and manage chats              |
| `Shift+↑` / `Shift+↓`                | Jump between messages                |
| `↑` / `↓`                            | Scroll the chat (outside text fields)|
| Ctrl+Click code, inline code or math | Copy it (math as LaTeX)              |
| Ctrl+Click a chat                    | Copy its transcript as markdown      |
| Alt+Click a chat                     | Export it as JSON                    |
| Alt+Click **New**                    | Import (chats or settings)           |

## Notes

- Markdown output is **not sanitised**: HTML in model output renders as HTML.
- Clearing site data deletes your chats and key. Export to back up.
- Settings exports never contain your API key; keep a copy of it elsewhere.
- Ollama reports the trained context length, which may exceed `num_ctx`.
- Copying an image needs a browser that supports image clipboard writes (`ClipboardItem`).
- Chat titles generated by earlier versions are dropped: only names you give a chat are kept.
- Image models used to be detected automatically. They now have to be identified once by hand.
- Chatting directly with image models has been removed, along with the **Image Models in Chat** and **Image Parameters** settings. Images from earlier chats with them are still shown.
- Old file-search data is deleted on load. Old search calls in chats are shown by name with their raw arguments.

## License

See [LICENSE](LICENSE).
