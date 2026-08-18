# Agent Instructions

This is a zero-runtime-dependency, no-framework, single-HTML-file chat client.
Everything below is a hard rule unless the user says otherwise.

## 1. Cohesion, not line count

There is **no arbitrary line limit**. Line count is not a proxy for cohesion.
The rule is:

* One module = one responsibility, explainable in a single sentence.
* If you cannot write that sentence without the word "and", split the module.
* A 15-line module is fine. A 400-line module is fine if it is one coherent thing.

## 2. Dependency direction

Imports flow one way only:

```
core → data → store → services → ui → app
```

* `core/` is **pure**. No `document`, no `indexedDB`, no imports from the store.
  Everything here must be testable in plain Node.
* `data/` owns persistence. It knows key formats and IndexedDB, nothing else.
* `store/` owns in-memory state and the event emitter. It may call `data/`.
* `services/` owns business logic and I/O. It may mutate the store and emit.
* `ui/` **renders and subscribes**. It never contains business logic.
* `app/` wires everything: commands, event delegation, shortcuts, bootstrap.

Never import "upwards". If a lower layer needs to notify a higher one, emit an
event. Circular imports are a bug, not a style issue.

## 3. No inline event handlers

There are no `onclick="..."` attributes and no `window.foo = foo` bindings.
All interaction goes through `data-command` attributes dispatched by
`app/events.js` against the registry in `app/commands.js`. To add an action,
add a command and reference its name from markup.

## 4. Single source of truth

Before adding a helper, check whether it already exists:

* Token estimation → `core/tokens.js`
* Duration / count formatting → `core/format.js`
* Progress percentages → `core/progress.js`
* Setting inheritance (file → global → default) → `core/values.js`
* IndexedDB key formats → `data/keys.js`

Never re-derive these inline. Never read state out of the DOM.

## 5. Deliberate decisions (do not "fix" these)

* **Markdown is rendered without a sanitizer.** `marked` output goes to
  `innerHTML`. This is a local, single-user tool where the user supplies both
  the API endpoint and the files; adding a sanitizer would mean a runtime
  dependency and would break inline math and code fences. If this ever becomes
  multi-user or serves untrusted content, this must be revisited first.
* **Users can execute arbitrary JS** via chunker/retrieval/merge hooks and God
  Mode. That is the product, not an oversight.
* **Prism languages are a fixed set** (`vendor/prism.js`). The CDN autoloader
  cannot be bundled. Unknown languages fall back to unhighlighted text.

## 6. Execution

* Do not output truncated code blocks.
* When moving a file, update every import path project-wide.
* Build output goes to `dist/`. Never commit generated files to the source root.
