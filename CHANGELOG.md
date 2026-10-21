# Orion Tauri 0.2.5 — Nightly

## Fixes and improvements

- Route managed EXL2 model chat requests through the ExLlamaV2 server and find each installed model root from its `config.json`, including models indexed by earlier nightly builds.
- Install ExLlamaV2's required `setuptools` and tokenizer packages through Orion's shared uv runtime, migrate existing private uv installs, repair older runtime environments, and verify dependencies before marking the engine ready.
- Remove the engine installation card from the model browser's Manage page.
- Add RAM and VRAM fit estimates for conversational model variants, filters for models that fit this PC, GPU fits, CPU or partial GPU fits, and models that may exceed available memory, plus best-fit sorting.
- Preserve the visible model card when quantization files are opened or model results refresh.
- Anchor populated chat messages to the bottom so new conversations flow upward from the latest exchange.
- Recover OrionFS after an unexpected worker failure and allow its regular status refresh to reconnect.
- Add the Engines settings tab for installing, updating and repairing, or uninstalling managed llama.cpp, ExLlamaV2 and stable-diffusion.cpp runtimes, with a link to the official Ollama installer.
- Import documents and folders into a conversation's OrionFS context from Canvas, extract supported document and PDF text, OCR supported scanned PDFs and images locally, and retain source details for citations. Index supported chat attachments into the active conversation automatically.
- Compact encrypted OrionFS snapshots into a versioned `.ofs` container using Orion's existing encryption. Reclaim unused SQLite pages, prune obsolete chunks and versions, retain only the current snapshot, and keep warmed retrieval free of per-query console logging unless `ORION_OFS_PROFILE=1` is set.
- Improve the Create page layout and make the creations panel independently scrollable.
- Clarify that the Tauri nightly carries forward stable 0.2.0 conversation history, checkpoints, branches, source receipts, local voice, Canvas tools and media creation while using a separate Tauri v2 shell and bundled Bun service.

- Replace Electron with Tauri v2 and a standalone Bun backend while retaining the Orion interface and application features.
- Reuse the existing Orion data directory, installed engines, models and encrypted data. Unlock the original Windows encryption key without replacing it.
- Embed the full browser UI and native browser tabs in the right Canvas sidebar, with document/browser switching, resizing, navigation, page extraction and keyboard shortcuts.
- Use native tray, file dialogs and process supervision; preserve local voice and OFS workers under Bun.
- Add Orion-managed ExLlamaV2 as a second local engine alongside llama.cpp. Engine setup verifies the NVIDIA driver and installs the exact prebuilt ExLlamaV2 wheel, PyTorch build and CUDA tier for the detected hardware.
- Extend the model browser with engine tags (#llama.cpp, #exllamav2, or both), engine-filtered conversational browsing, and full EXL2 support: quantization branches are listed as complete bundles, downloaded with SHA-256 verification, managed in Manage, and routed to the ExLlamaV2 server in chat exactly like GGUF models.
- Build Tauri-specific Windows installers and portable ZIPs. Keep update packages separate from Electron assets.

# Orion 0.2.0 — Conversation memory, alternate paths and local voice

- Refine the chat surface with unified sidebar/composer colors, a smooth inset shape, a restrained top focus highlight and animated Canvas transitions. Keep the Canvas toggle in the top bar.
- Hide Conversation History on empty chats, reuse an existing Untitled chat on startup, and hide the Model server row when neither Ollama nor a provider is set up.
- Consolidate checkpoints, assumptions, recall controls, local handoffs, branch comparison and reviewed cleanup into Conversation History with one quiet composer entry.
- Add source receipts below answers for recalled memory and attached-file context, linked to original messages.
- Add local model selection and opt-in Canvas documents for reviewed handoffs, with local-only inference, tool and memory boundaries.
- Add scoped cleanup of active memories, checkpoints, dismissed assumptions and Canvas copies, plus revalidated cleanup of unused attachment images older than 24 hours.
- Improve dictation with broader-data streaming recognition, startup audio context and sentence casing. Use full-precision Kokoro with natural pause timing, paired optional setup and in-dialog voice auditions.
- Add voice-aware composer placeholders and an optional automatic Thinking collapse when the final response starts.
- Add native local voice with live English dictation, an independent neural read-aloud toggle, and a microphone button immediately beside Send. Send by button, Enter, or the exact standalone spoken command “send the message”.
- Add six Kokoro neural voices, voice previews and speed control in Settings → Voice. Download the native runtime and each model component only after first-use setup is accepted; unused voice features install nothing.
- Keep raw audio in memory, isolate speech inference from the UI, release microphone/voice resources on cancellation and closure, and avoid recordings, separate transcript logs or speech telemetry.
- Keep dictated conversations, branches, carry-forward context and voice-derived memories local-only. Block hosted inference, Ollama cloud models and network tools for those conversations; exclude protected voice memories from ordinary and hosted recall.

- Add a horizontal checkpoint timeline with previews of messages, OrionFS memory, assumptions, and Canvas documents. Continue from a saved checkpoint in a separate branch without changing the original conversation.
- Add assumption checkpoints with evidence links, inferred/user-stated provenance, explicit user confirmation, corrections, dependent-answer review markers, and revision prompts for affected Canvas work.
- Add per-conversation memory lenses for conversation, named-project, personal, and all-conversation recall, with memory pins, exclusions, sharing labels, and source navigation.
- Show automatically recalled memory snippets on individual answers and make sidebar memory counts follow the active lens and branch.
- Add editable, reviewed carry-forward packets containing selected context, constraints, decisions, open questions, memories, and Canvas documents. Continuations start without hidden copies of the old memory store.
- Add local branch comparison for message change counts, memories, assumptions, carried decisions, and Canvas revisions, with a shortcut to continue the preferred path.
- Encrypt checkpoint history and branch data with Orion’s existing local storage key; compress snapshots and deduplicate stored vectors. Remove unreferenced checkpoint storage when conversations are deleted.
- Preserve branch isolation across restarts, keep mutations out of active inference, and prevent a failed initial snapshot import from being treated as an initialized branch.
- Restore saved Canvas documents when opening another conversation from history.

Windows x64: installer and portable EXE. Linux x64: AppImage, DEB and RPM. macOS is not currently supported.

# Orion 0.1.9 — More forgiving graph headings

- Accept optional colons in simple OGS graph headings, so `venn: Three sets` and `bar: Weekly counts` render like their space-separated equivalents.

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
