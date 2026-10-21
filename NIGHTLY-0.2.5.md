# Orion 0.2.5 Nightly

This nightly is the Tauri v2 edition of Orion, developed alongside the stable Electron release. It carries forward the stable 0.2.0 conversation history, checkpoint and branch tools, source receipts, local voice, OrionFS memory and creation features, and adds the changes below. It uses the existing Orion per-user data directory so conversations, encrypted settings and API keys, memories, installed models, engines and voice setup remain available.

## New since stable Orion 0.2.0

### Tauri desktop runtime

- Rebuild Orion's desktop shell with Tauri v2 and a standalone Bun service. Bun, Node.js and npm are not required on users' computers.
- Use native Tauri windows, tray integration, dialogs and child-process supervision while keeping Orion's familiar interface and workflows.
- Open Orion Browser inside the right Canvas sidebar, with tabs, address and navigation controls, page-reading tools, keyboard shortcuts and a resizable panel.
- Reuse the existing Orion data directory and unlock the existing Windows encryption key in place. The nightly does not require reinstalling models or importing conversations.

### Local engines and model browsing

- Add an Engines settings tab to install, update and repair, or uninstall Orion-managed llama.cpp, ExLlamaV2 and stable-diffusion.cpp engines. Ollama can be installed by opening its official installer.
- Add managed ExLlamaV2 for EXL2 models alongside llama.cpp for GGUF. Setup uses Orion's managed uv runtime, detects the available NVIDIA/CUDA combination and verifies the installed runtime.
- Browse EXL2 quantization branches as complete model bundles, verify downloaded files, and route installed models through the ExLlamaV2 server. EXL2 supports text chat and Orion's tool protocol; image attachments use GGUF-capable engines.
- Show estimated RAM and VRAM fit for conversational model variants, with filters for models that fit the PC, GPU fit, CPU or partial GPU fit, and models that may exceed available memory. Sort by best fit.
- Keep model cards in place while quantization choices load and separate conversational models from image and video models in Manage.

### Documents, OrionFS and Canvas

- Import documents and folders into the active conversation's OrionFS memory from Canvas. Orion extracts text from supported documents, PDFs and source files, and uses local OCR for supported scanned PDFs and images. Imported passages keep their source details for retrieval and citation.
- Automatically index supported chat attachments into that conversation's OrionFS context, so follow-up questions can use the material without uploading it to a separate service.
- Store encrypted OrionFS snapshots in a compact, versioned `.ofs` container using Orion's existing at-rest encryption. Snapshot sealing reclaims unused SQLite pages, removes obsolete chunks and versions, and keeps only the current snapshot while preserving the encrypted data format.
- Keep memory recall local and model-free. Warmed vector retrieval runs from an in-memory cache, while the compact snapshot reduces startup extraction and disk use.
- Give the Create page more room for generation and make its creations panel independently scrollable.

### Chat and runtime reliability

- Anchor populated conversations at the latest messages so new chats begin near the composer and flow upward naturally.
- Recover the OrionFS worker after an unexpected failure and reconnect through the normal status refresh.
- Route managed EXL2 chats through the right server, resolve older model indexes from each model's `config.json`, and keep model loads from starting automatically on app launch.

All stable 0.2.0 conversation history, memory checkpoints, branching and comparison, source receipts, local handoff, voice, Canvas, chat tools, web search and image/video creation remain part of this nightly.

## Downloads and support

- Windows x64: setup EXE, portable EXE and portable ZIP.
- Linux x64: AppImage, DEB and RPM.
- macOS is not currently supported.

This is a prerelease for testing. Linux desktop and legacy Linux keyring migration need further runtime validation, and full Wan video generation may vary with model and hardware. EXL2 requires a supported NVIDIA GPU; GGUF through llama.cpp remains available on other systems. The original Electron source and stable release remain unchanged.
