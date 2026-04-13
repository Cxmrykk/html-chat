# HTML Chat

A minimalist, high-performance AI chat interface that functions as a single, portable HTML file. This application runs entirely client-side, using the browser's IndexedDB for storage and standard Web APIs for LLM communication.

## Core Features

- **Zero Backend**: No Docker or Node.js required. The application communicates directly from your browser to OpenAI-compatible APIs.
- **Local RAG (Retrieval-Augmented Generation)**: Upload documents to create a local vector database. The system performs chunking and embedding (via API) to provide context-aware responses from your files.
- **God Mode (Code Execution)**: Allows the LLM to write and execute JavaScript directly within your browser session to perform maths, data processing, or DOM manipulation.
- **State Persistence**: Uses IndexedDB to store chat history, uploaded files, and configuration. Data remains on your machine.
- **Advanced Parameter Control**: Granular control over temperature, top_p, frequency penalties, and RAG configurations (chunk size, overlap, and similarity thresholds).
- **Rich Rendering**: Full support for Markdown, LaTeX (via KaTeX), and syntax highlighting (via Prism.js).

## Getting Started

1. Open `index.html` in any modern web browser.
2. Enter your API Base URL (default is OpenAI) and your API Key in the sidebar.
3. Configure your available models as a comma-separated list.
4. Click Save.

## Keyboard Shortcuts

| Shortcut                           | Action                                             |
| :--------------------------------- | :------------------------------------------------- |
| Ctrl/Cmd + Enter                   | Send message / Save edit / Save setting            |
| Ctrl/Cmd + Shift + Enter           | Append message to chat history without calling API |
| Alt + T                            | Create new chat                                    |
| Alt + W                            | Delete current chat                                |
| Alt + R                            | Rename current chat                                |
| Alt + P                            | Toggle sidebar visibility                          |
| Alt + O                            | Toggle header visibility                           |
| Alt + I                            | Toggle Super Secret Settings visibility            |
| Shift + Up/Down                    | Scroll between messages                            |
| Alt + Up/Down                      | Switch between chats                               |
| Ctrl/Cmd + Click (on code/maths)   | Copy content to clipboard                          |
| Ctrl/Cmd + Click (on sidebar chat) | Copy entire chat as Markdown                       |
| Alt + Click (on sidebar chat)      | Export specific chat as JSON                       |

## File Management and RAG

- **Upload**: Use the + Upload button to add text-based files.
- **Full Injection**: Clicking a file name in the sidebar injects the entire file content into the prompt.
- **Embedding/Search**: Click the "e" button on a file to index it. Once indexed, you can use "Insert Embedding" to allow the system to pull only relevant chunks based on your prompt or subsequent user messages.
- **Configuration**: In "Super Secret Settings," you can define which embedding model to use and adjust retrieval thresholds.

## God Mode

When "Execute JavaScript" is enabled, the system adds a specialised system prompt that allows the LLM to use `<run>` tags.

- **Sandbox**: Code runs in an async function scope within your browser.
- **Persistence**: Variables do not persist between blocks unless attached to the `window` object.
- **Safety**: Only enable this when using trusted models, as the code has access to your browser's local storage and current session.

## Configuration Tiers

### Basic Settings

Located in the sidebar for quick access to API credentials and model selection.

### Super Secret Settings

Accessed by Ctrl/Cmd + Clicking the "Settings" header. This unlocks:

- System prompt customisation for God Mode.
- LLM sampling parameters (Temperature, Top P, Max Tokens).
- RAG parameters (Chunk size, overlap, batch size, and search thresholds).
- Custom Embedding API URLs and keys.

## Development and Build

The project is modularised for easier development. The final `index.html` is a compiled version of the source components.

### Structure

- `index.src.html`: The base HTML template.
- `styles.css`: Standard CSS styles.
- `scripts/`: Modular JavaScript files sorted by execution order.
- `build.py`: Python script to assemble the components.

### Building

To generate the final single-file redistribution, run:

```bash
python3 build.py
```

This script reads the source HTML, calculates the necessary indentation for the placeholders, and injects the CSS and combined JavaScript into the final file.
