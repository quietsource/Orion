# Orion 0.1.8 — Canvas, composer and video creation

- Preserve tool and web-search chronology, including searches after question/answer tools.
- Simplify OGS authoring with a line-based format for local models, optional display titles, compatible JSON graph fences, and safe recovery of recognizable Venn overlap formatting mistakes.
- Provide model-facing OGS examples and automatically request bounded graph corrections after a completed turn, using an isolated, context-budgeted conversation without prior tool-call history.
- Replace loading dots with a small live liquid-metal form and “Waiting for model”.
- Replace the application, installer, window, and tray icons with a transparent still of Orion’s native liquid-metal artwork.
- Prevent background model loading: disable historical schedule dispatch at startup and make system-prompt inspection metadata-only. Models load when generation or an explicit compatibility check is requested.

- Align the animated welcome and greeting with the composer center and lift the welcome group slightly above the composer.
- Add a dedicated create_video chat tool using the same live media generation card and chat-model handoff as image creation. Image and video generation in Create share the same progress card.
- Move model and context selectors into the composer beside attachments and token usage, with embedded controls and upward-opening Orion menus.
- Use one fixed Orion appearance, remove theme selection and the Appearance settings tab, and clarify the system tray setting.
- Add hover-revealed, draggable and keyboard-accessible sidebar resize handles with remembered widths. Canvas starts narrower.
- Unify Canvas source editing, simplify selected-text notes and AI revisions, and reopen generated documents from chat.
- Give the Canvas tool read, precise edit and reopen actions, preserving complete documents and unrelated content.

# Orion 0.1.7 — Native graphs and a simpler composer

- Added Orion Graph System (OGS): native chat diagrams, networks, line and bar charts, pie charts, radar charts, and Venn diagrams from compact model-authored data. Includes data views, copy, SVG export, and bounded local rendering.
- Structured model instructions around the model's own trained identity, complete implementations, accurate evidence, and the exact tools available for each request.
- Required complete requested code without placeholders, stubs, TODO substitutions, or intentionally reduced implementations.
- Removed the plan/checklist card and its tools.
- Made reasoning automatic through model capabilities and runtime defaults; removed composer thinking and reasoning-level controls.
- Removed the Web button and footer tagline. Docked the composer to the bottom of chat with a thin outline, no bottom border, and outward curved lower corners.
- Replaced the welcome text with a live liquid-metal surface on a transparent background. Its 3D geometry and reflections evolve continuously, with reduced-motion support and animation suspended when hidden.
- Unified the composer body and lower corners in one vector surface for smooth curves, consistent fill, and exact bottom-edge alignment.
- Added conversation-scoped message queues above the composer: Enter queues during generation, messages continue in order, and each compact card has send-now and delete controls. Send-now waits for cancellation before dispatching; drafts and attachments are retained.
- Centered a smaller liquid-metal welcome form and subtle greeting above the composer, and removed empty-chat scrolling at desktop and narrow window sizes.

# Orion 0.1.6 — Clearer update status

- Corrected update status messages to describe downloading and opening the installer, matching the visible installation flow.
- Kept the main chat area frameless, removing its enclosing outline and rounded corners while preserving layout spacing.
- Added compatibility checks for installed managed conversational models. Orion can validate a newer official llama.cpp runtime and save it as a model-specific repair when supported.
- Automatically check compatibility after managed model compatibility failures, showing progress and repair results through chat tool activity before retrying supported models.

# Orion 0.1.5 — Cleaner chat activity and consistent model restoration

- Update downloads now open a visible Windows setup wizard or the Linux system package installer, then close Orion. Portable Windows and AppImage downloads launch as the new version after Orion exits. Downloaded packages remain in Downloads for manual use.
- Redesigned tool calls and web searches as compact disclosure rows with outline icons, muted text, tight spacing, and expandable inputs.
- Show tool results and web sources directly in chat. Image generation appears in its own live card beneath the tool row and transitions into the generated image or video.
- Fixed follow-up inference using an obsolete llama.cpp port after the Create Image tool restored the chat model. Each request and reconnect attempt now resolves the current managed server address.
- Check managed model health before reusing a process and restart an unresponsive runtime before inference. Reconnect delays now respect cancellation.
- Fixed live generation progress updates after moving the media card outside the tool dropdown.

# Orion 0.1.4 — Reliable Windows updates

- Hardened the Windows update handoff: Orion now records installer diagnostics, verifies the installed version, locates the updated application, and only then relaunches it.
- Fixed the updater silently reopening the previous executable when installation did not complete as expected.

# Orion 0.1.3 — Smoother media generation and chat activity

- Matched image and video generation from chat to the Create tab, including live progress, generated media preview, and a clear model-restoration state.
- Improved local model reconnection during media handoff so brief server restarts do not immediately surface as a failed chat request.
- Refined web research and tool activity in chat with a compact embedded layout, readable long inputs and results, and clearer progress and status.

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
- Orion Browser controls, Markdown and code rendering, and syntax highlighting.
- Optional continued operation from the system tray.
- Bun-based installation, development, build, and packaging commands; Electron provides the desktop runtime.

## Platform support

- Windows x64 is supported. The release provides a setup installer and a portable executable.
- Linux x64 is supported. The release provides AppImage, Debian (`.deb`), and RPM packages.
- **macOS is not currently supported.** No macOS packages or supported macOS installation are provided.

## Privacy

Conversation history, settings, OrionFS memories, downloaded models, and generated media are stored in the local user-data directory. Local inference stays on the computer. When a hosted API provider is selected, it receives the prompts and relevant memory for that request. Model downloads, web search, and first-time backend setup use the network. API keys are stored locally with restricted file permissions and are not encrypted at rest.
