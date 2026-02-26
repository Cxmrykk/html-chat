# html-chat

This is a motherfucking chat interface.

### Seriously, what the fuck else do you want?

You probably build AI wrappers and think your shit is special. You think your 500MB Docker container, Next.js hydration, and 80-pound `node_modules` folder give Vercel a boner because you finally figured out how to stream a server response. Wrong, motherfucker.

Let me describe your perfect-ass AI chat app:

- It's one fucking file.
- It requires zero build tools. No `npm install`. No Webpack. No bullshit.
- It runs locally in your browser and saves your shit to `localStorage`.
- It renders Markdown, Math (KaTeX), and Code (Prism) perfectly.
- It's lightweight, loads instantly, and doesn't track your every fucking keystroke.

### Well guess what, motherfucker:

You. Are. Over-engineering. Look at this shit. It's a motherfucking HTML file. Why the fuck do you need a React state management library just to append text to a `div`? You spent hours configuring Tailwind and added 100 megabytes of dependencies to your fucking project, and some motherfucker just wants to ask GPT-4 how to center a div.

You never knew it, but this is your perfect chat interface. Here's why.

## It's fucking lightweight

This entire app is a single `index.html` file. You download it. You double-click it. It opens in your browser. That's it. No servers, no databases, no cloud-native serverless edge-computing buzzword bingo. You put in your OpenAI API key, and you start typing.

## It has "God-Mode"

You know how LLMs suck at math and logic? Not here. If you check the **God-Mode** box, the AI is instructed to write vanilla JavaScript, execute it directly in your browser's console, and read the output before answering you. It literally writes code, runs that shit, and gives you the real answer instead of hallucinating.

_(Is it safe? It runs in your browser's sandbox. Don't tell it to delete your `localStorage` and you'll be fine, you baby.)_

## It fucking works

Look at this shit. It has features you actually need:

- **Forking:** Branch off a conversation from any message.
- **Editing:** Fix your typos and regenerate.
- **Model Switching:** Swap between `gpt-4o`, `gpt-3.5-turbo`, or whatever the fuck else you want on the fly.
- **Copying:** Hold `Ctrl` (or `Cmd`) and click any code block or math equation to instantly copy it to your clipboard.

## Keyboard Shortcuts for Power Assholes

Because clicking is for people who have time to waste.

- `Ctrl + Enter` / `Cmd + Enter` - Send your fucking message.
- `Alt + T` - New chat.
- `Alt + W` - Delete current chat.
- `Alt + R` - Rename current chat.
- `Alt + P` - Hide the sidebar.
- `Alt + O` - Hide the title header.
- `Alt + Up/Down` - Cycle through your chats.
- `Shift + Up/Down` - Scroll the chat history without touching your mouse.

## Dependency Honesty

Yes, there are `<script>` tags in the `<head>`. We use Marked, KaTeX, and Prism via CDN. Why? Because we aren't masochists. We value our time and sanity more than writing a custom regex parser for LaTeX in vanilla JS. They load fast, they get cached, and they get the fuck out of the way.

## How to use it

1. Save `index.html` to your computer.
2. Double-click it.
3. Put your API key in the settings sidebar.
4. Start typing.

> "Good design is as little design as possible."  
> \- _some German motherfucker_

---

_License: Do whatever the fuck you want with it._
