# HTML Chat

No 500MB Docker containers. No build steps. No bullshit. Just you, your API key, and the browser.

### Features

- **Single-File Supremacy:** The entire application is one `.html` file.
- **Bring Your Own API:** Fully configurable Base URL and API Key. Works out of the box with OpenAI, or any local/proxy setup (Ollama, LM Studio, vLLM).
- **God-Mode (JS Execution):** The LLM can write and execute JavaScript directly in your browser to solve complex math, run simulations, or process data instead of hallucinating answers.
- **Zero-Bloat Rendering:** Native Markdown, KaTeX for math, and Prism for syntax highlighting loaded via CDN. No Webpack, no Vite.
- **Local-First:** All chats, settings, and states are saved directly to your browser's `localStorage`.
- **Power-User Workflows:**
  - Fork conversations from any message.
  - Edit and retry prompts.
  - `Ctrl/Cmd + Click` on any code block or math equation to instantly copy it.
  - `Ctrl/Cmd + Click` a chat in the sidebar to copy the entire conversation as Markdown.
- **Keyboard Driven:**
  - `Ctrl+Enter`: Send / Save edits
  - `Alt+T`: New Chat
  - `Alt+W`: Delete Chat
  - `Alt+R`: Rename Chat
  - `Alt+Up/Down`: Switch between chats
  - `Alt+P` / `Alt+O`: Toggle Sidebar / Title

### Installation

1. Download `index.html`.
2. Double-click it.

### Philosophy

A chat interface is fundamentally just a list of text strings, yet the industry standard is to wrap it in a 500MB Node environment, compile it through three different build tools, ship it through docker, and "hydrate" it on the client.

This project operates on a few strict rules:

1. **No Frameworks:** If you think a chat app needs React, you are the problem. Template literals and `document.querySelector` work fine.
2. **No Build Tools:** If it doesn't run by double-clicking the `.html` file, it gets deleted. We keep the single-file portability aspect.
3. **Dependency Honesty:** We use Marked, KaTeX, and Prism because writing a Markdown parser from scratch is masochism. We value our time more than saving 100kb of minified JS.
4. **Performance is a Feature:** We don't animate. We don't fade. We render the HTML and we get out of the way.

### FAQ

**Why is only the OpenAI API format supported?**  
Because it is the de facto industry standard and keeps the codebase incredibly simple. If you want to use Anthropic, Gemini, or local models, just run [LiteLLM](https://github.com/BerriAI/litellm) or Ollama locally and point the Base URL to `http://localhost:4000/v1`. We aren't writing custom API wrappers for every AI startup that launches this week.

**What exactly is "God-Mode"?**  
LLMs suck at math and logic. God-Mode injects a system prompt that teaches the LLM how to write JavaScript inside `<run>` tags. The app intercepts these tags, executes the code in your browser's JS console, and feeds the result back to the LLM. It allows the model to iteratively write code to solve problems before giving you a final answer.

**Where is my data stored?**  
In your browser's `localStorage`. There is no backend, no telemetry, and no database. If you clear your browser data, your chats are gone.

**Can I add [Feature X]?**
If it doesn't improve the utility of generating text, it is bloat. Feel free to enable "God-Mode" and ask the LLM to personalise your interface.
