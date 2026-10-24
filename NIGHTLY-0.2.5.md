# Orion 0.2.5 Nightly

This nightly is Orion's Tauri v2 edition, developed alongside the stable Electron release. It carries forward stable 0.2.0 features including conversation history, checkpoints and branches, source receipts, local voice, OrionFS memory, Canvas, and image and video creation. Tauri uses Orion's existing per-user data directory, so conversations, encrypted settings and API keys, memories, installed models, engines, and voice setup remain available.

The nightly is published in place on the `nightly` line while the Tauri edition is tested and brought toward feature parity. The sidebar keeps the concise **Agents** label; the feature and workspace are presented as **Orion's Belt**.

### Orion's Belt

- Replace the earlier Swarm presentation with Orion's Belt, a persistent, private team of multiple local models coordinated by the Belt harness. Choose distinct local models and select an available engine for each model; Belt hands work between them sequentially so it does not need to keep all model weights loaded at once.
- Give each Belt its own persistent workspace, files, history, and OrionFS memory. The workspace is mounted for the user to inspect and manage its files. Belt pauses while Orion is in use, only one Belt can run at a time, and users can steer, pause, inspect activity, or stop its work.
- Require explicit user approval when Belt requests network access. The initial goal and user-defined completion evidence guide work and determine when a task is complete.

### Interface and model selection

- Use Orion-styled right-click menus throughout the app, including text selection, editable fields, links, media, code, and the embedded browser. Native WebView context menus are suppressed.
- Replace native select popups and browser validation bubbles with rounded Orion menus and validation messages, including in Settings dialogs.
- Keep Chat, Create, Orion's Belt, and Model Browser inside the continuous application frame. Model browsing starts at its heading and clips result cards within the frame.
- Match Create and Orion's Belt composers to Chat's shared framing and focus treatment, and refine the Belt workspace and model selection layout.
- Show each conversational model once in the model browser and let the user choose its engine from the model entry. Keep quantization choices anchored to their cards while loading, and separate conversational models from image and video models in Manage.
- Estimate RAM and VRAM fit for conversational model variants, with filters for models that fit the PC, GPU fit, CPU or partial GPU fit, and models that may exceed available memory.

### Local engines and model support

- Add an Engines settings tab to install, update and repair, or uninstall Orion-managed llama.cpp and stable-diffusion.cpp engines. Ollama can be installed by opening its official installer.
- Bundle Orion Inference for local chat models in GGUF, GPTQ, and AWQ formats, with CUDA support on Windows. The model browser searches supported formats for Orion Inference and limits llama.cpp results to GGUF; its Orion compatibility tag is reserved for models identified as compatible.
- Add an engine selector in the chat composer. Use Orion Inference by default, or choose an installed llama.cpp engine for GGUFs, Ollama for Ollama models, or a configured API provider.
- Tune Orion Inference prefill chunk sizing to available GPU memory and make runtime efficiency improvements. llama.cpp remains available as an alternate engine; performance depends on model, hardware, and workload.

### Documents, OrionFS and Canvas

- Import documents and folders into the active conversation's OrionFS memory from Canvas. Orion extracts text from supported documents, PDFs, and source files, and uses local OCR for supported scanned PDFs and images. Imported passages retain source details for retrieval and citation.
- Automatically index supported chat attachments into that conversation's OrionFS context, so follow-up questions can use the material without uploading it to a separate service.
- Store encrypted OrionFS snapshots in a compact, versioned `.ofs` container using Orion's existing at-rest encryption. Snapshot sealing reclaims unused SQLite pages, removes obsolete chunks and versions, and keeps the current snapshot while preserving the encrypted data format.
- Keep memory recall local and model-free. Warmed retrieval runs from an in-memory cache, while the compact snapshot reduces startup extraction and disk use.
- Give the Create page more room for generation and make its creations panel independently scrollable.

### Chat, OGS and runtime reliability

- Improve local-model system prompt guidance, including clearer instructions for Orion Graph System (OGS) diagrams and structured graphs, and stronger expectations for complete, usable code when code is requested.
- Improve OGS formatting guidance and recovery instructions so a model can correct invalid graph data and retry after validation errors.
- Anchor populated conversations at the latest messages so new chats begin near the composer and flow upward naturally.
- Recover the OrionFS worker after an unexpected failure and reconnect through the normal status refresh.
- Normalize Windows resource paths in the bundled service so native Canvas modules load correctly in installed and portable packages.
- Resolve older model indexes from each model's `config.json`, and keep model loads from starting automatically on app launch.

All stable 0.2.0 conversation history, memory checkpoints, branching and comparison, source receipts, local handoff, voice, Canvas, chat tools, web search, and image and video creation remain part of this nightly.

### Downloads and support

- Windows x64: setup EXE, portable EXE, and portable ZIP.
- Linux x64: AppImage, DEB, and RPM.
- macOS is not currently supported.

This is a prerelease for testing. Linux desktop and legacy Linux keyring migration need further runtime validation, and full Wan video generation may vary with model and hardware. Orion Inference uses CUDA on Windows and a CPU backend on other supported builds. The original Electron source and stable release remain unchanged.
