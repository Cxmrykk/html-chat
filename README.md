# HTML Chat

A zero-dependency, single-file AI chat interface that runs entirely in your browser. No Docker, no Node.js, no backend required.

## Features

- **Local-First Storage**: All data persists in the browser
- **Code Execution**: Execute JavaScript directly in the browser
- **Rich Content**: Markdown, LaTeX (KaTeX), and code highlighting via CDN
- **Keyboard Shortcuts**: Optimized for power users
- **Portable**: Single HTML file with no external build dependencies (just a python script)
- **Import/Export**: JSON chat history management

## Usage

- Visit [https://cxmrykk.github.io/html-chat/](https://cxmrykk.github.io/html-chat/) for an out-of-the-box experience.
- You can also download [`index.html`](https://github.com/Cxmrykk/html-chat/blob/main/index.html) and open it in your browser. 

## Keyboard Shortcuts

| Shortcut               | Action                          |
| ---------------------- | ------------------------------- |
| `Ctrl/Cmd+Enter`       | Send message / Save edit        |
| `Ctrl/Cmd+Shift+Enter` | Append message to chat          |
| `Alt+T`                | New chat                        |
| `Alt+W`                | Delete current chat             |
| `Alt+R`                | Rename current chat             |
| `Alt+P`                | Toggle sidebar                  |
| `Alt+O`                | Toggle title bar                |
| `Alt+Click`            | Export chat                     |
| `Ctrl/Cmd+Click`       | Copy chat as Markdown           |

## God Mode

Enable in settings to allow LLMs to execute JavaScript in your browser. Use with caution - executes real code in your environment (no sandbox).

```js
<run>
// Example God Mode code
return Math.sqrt(9999);
</run>
```

_(Note: Injects a System prompt at the start of the current chat.)_

## Change Message Role

Click the message role ("Assistant", "User", etc.) to change it. You can also create system prompts with this function.

## Configuration

Set your API endpoint and key in the sidebar settings. Supports any OpenAI-compatible API endpoint (e.g. LiteLLM).

More configuration options are available in the "Super Secret Settings" (CTRL-Click the "Settings" text).

## Development

Edit files in `scripts/`, `styles.css`, or `index.src.html`, then rebuild with `build.py`. The build script injects CSS and JS into the final `index.html`.

1. Clone the repository

    ```bash
    # The latest commit
    git clone https://github.com/cxmrykk/html-chat.git
    ```

2. Run the builder script:

    ```bash
    # Combines all javascript files in ./scripts
    # replaces the <script> and <style> placeholders in index.src.html
    python3 build.py
    ```

3. Open `index.html` in any modern browser.