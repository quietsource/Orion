# Orion 0.1.2 — Reliable updates and smoother model browsing

- Moved update notices and download progress into the sidebar and hardened Windows update installation and relaunch so Orion verifies the installer handoff before showing release notes.
- Fixed model download cancellation so active transfers stop and incomplete temporary files are removed.
- Preserved model browser scroll position while choosing model files, split installed models into conversational and image/video sections, and added next-page browsing.
- Improved chat follow behavior for reasoning and code/output panes, and added syntax highlighting while code streams.
- Added a conversation-scoped plan/checklist card near the composer and instructed Orion to keep it current as work progresses.
- Removed Mermaid diagram rendering and its tool.

# Orion 0.1.1 — GPU inference and live resource monitoring

- Added live CPU, RAM, GPU, and VRAM usage to the sidebar resource monitor, updated every second. NVIDIA utilization and memory are read directly from `nvidia-smi`; other supported GPUs use system information reported by their driver.
- Pinned Stable Diffusion image and Wan video diffusion weights to the Vulkan device and eagerly load them on the GPU. Wan text encoding and VAE remain on CPU to reserve VRAM for diffusion inference.
- Kept the resource monitor responsive by separating its sampling from the slower model-server connectivity check.

# Orion 0.1.0 — Initial release

Orion 0.1.0 is the first public release.

## Features

- Local chat with installed Ollama models and Orion-managed GGUF models served by llama.cpp, plus optional OpenAI-compatible API providers.
- Streamed responses, model-provided reasoning when available, conversation history, file attachments, and context-window controls.
- OrionFS (OFS) as Orion's local memory engine, with saved memories and memory statistics in Settings.
- General chat tools for web search, page reading, local application actions, questions, and Canvas. These tools run without per-action approval prompts. Project workspace tools are disabled in this release.
- Canvas for working with documents and code, including source editing and preview where supported. Canvas state belongs to the current conversation.
- Orion Create with a managed `stable-diffusion.cpp` Vulkan runtime for Stable Diffusion image generation and Wan video generation.
- Orion Browser controls, Markdown and code rendering, syntax highlighting, and Mermaid diagrams.
- Local recurring schedules, with optional continued operation from the system tray.
- Bun-based installation, development, build, and packaging commands; Electron provides the desktop runtime.

## Platform support

- Windows x64 is supported. The release provides a setup installer and a portable executable.
- Linux x64 is supported. The release provides AppImage, Debian (`.deb`), and RPM packages.
- **macOS is not currently supported.** No macOS packages or supported macOS installation are provided.

## Privacy

Conversation history, settings, OrionFS memories, downloaded models, and generated media are stored in the local user-data directory. Local inference stays on the computer. When a hosted API provider is selected, it receives the prompts and relevant memory for that request. Model downloads, web search, and first-time backend setup use the network. API keys are stored locally with restricted file permissions and are not encrypted at rest.
