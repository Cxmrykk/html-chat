
That's every file: 26 modified and 3 new (`services/api/images.js`, `services/image-generation.js`, `services/tools/images.js`). I haven't run any of it, and these server details are guesses:

- **Ollama:** I assumed Ollama reports image models with an `image` capability and serves `/v1/images/generations` and `/v1/images/edits`. Check this against your Ollama version; if it uses a different name, it's one constant in `core/capabilities.js`.
- **llama.cpp:** it reports nothing about image generation, so those models have to be listed under **Image Models**. They'll then work as long as the server behind them speaks the Images API (e.g. stable-diffusion.cpp).
- **`response_format`:** only `dall-e*` models are asked for `b64_json`, because `gpt-image-*` rejects that field. For any other server that returns URLs the browser can't download, set it in **Image Parameters**.

A few choices you didn't specify:

- **Image Parameters is global, not per-model.** Making it per-model would need a second model selector in the settings view.
- **`edit_image` won't use placeholders.** It fails and tells the model the original isn't stored, because the tool can't ask you to confirm sending a placeholder. In chat mode with an image model, placeholders are allowed, as in normal sends.
- **Image ids are only added to outgoing user images while the image tools are offered.** Otherwise what's sent to the model is unchanged.
- **Placeholder warnings with an image model** only cover the message being sent, since nothing earlier in the chat goes out.

`README.md` doesn't describe any of this yet. I can add the new settings, the Generate Images checkbox and the three tools to it if you want.
