# Agent Instructions

You are collaborating on this project. You must STRICTLY obey the following rules. There are no exceptions.

## 1. The 200-300 Line Rule
* Every JavaScript file MUST NOT exceed 300 lines.
* If your changes cause a file to exceed 300 lines, you MUST split it into smaller logical modules inside a relevant subdirectory (e.g., `scripts/ui/` or `scripts/embeddings/`).
* If your changes cause a file to drop below 200 lines, you MUST merge it with another logically related file to stay within the 200-300 range.

## 2. File Organization
* Never dump files into the root `scripts/` directory if they belong in a domain cluster. Use subdirectories like `scripts/ui/` or `scripts/embeddings/`.
* When splitting or moving files, update all ES module `import` and `export` paths project-wide.
* If moving a function that is bound to an inline HTML event (e.g., `onclick="doThing()"`), ensure it remains assigned to the `window` object inside the entry point (`main.js`).

## 3. Execution
1. Count the lines of the file *before* and *after* you plan to modify it.
2. If your change breaks the 200-300 line boundary, propose the refactor to the user immediately.
3. Do not output truncated code blocks.
