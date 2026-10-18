# Orion

Orion is a local-first desktop app for chatting with AI models, using research and productivity tools, and creating images and video. The latest published release is `0.1.9`. The local `0.2.0` build adds five conversation-memory features and private local voice and is awaiting release approval.

Orion is built with Electron and TypeScript. Bun is used to install dependencies, run development commands, build, and package Orion. Electron includes the runtime needed by the desktop app, so a separate system Node.js installation is not required.

## Demo

https://github.com/user-attachments/assets/4aa7f610-f0c9-4b78-84ed-e233e043577e

## Platform support

- **Windows x64:** supported. The release provides a setup installer and a portable executable.
- **Linux x64:** supported. The release provides AppImage, Debian (`.deb`), and RPM packages.
- **macOS:** not currently supported. Orion does not provide supported macOS builds or installers.

Download the current packages from [GitHub Releases](https://github.com/quietsource/Orion/releases).

## What Orion includes

- Chat with models from a local Ollama server, Orion-managed GGUF models using llama.cpp, or a configured OpenAI-compatible API provider.
- Streamed answers and model-provided reasoning when the selected model and provider support it.
- Conversation history, per-conversation Canvas documents with direct editing, AI revisions and reopen controls, file attachments, Markdown rendering, and live syntax highlighting.
- Resizable conversation and Canvas sidebars, with model and context selection in the composer.
- Orion Graph System (OGS) for native chat diagrams, networks, line/bar/pie charts, radar charts, and Venn diagrams. Models describe data and connections; Orion handles rendering, accessible data views, and SVG export. See the [OGS guide](docs/orion-graph-system.md).
- Automatic model reasoning with runtime defaults, and a compact composer docked to the bottom of chat.
- Queue follow-up messages with Enter while a response is generating. Compact cards above the composer provide send-now and delete controls; queued messages run in order without replacing an unsent draft. Pending queues stay in memory for the current app session.
- OrionFS (OFS) local memory. OFS stores attributed statements and their associations locally and recalls relevant memories without a separate embedding model or network service. Saved memories are available in Settings. The local 0.2.0 build adds a Memory panel beside the composer context meter.
- General chat tools for web search and page reading, local application actions, questions, Canvas, and image/video creation with live progress cards. Tools run without per-action approval prompts. Project workspace tools are currently disabled.
- Orion Browser controls for opening and reading HTTPS pages in Orion's browser.
- Orion Create, which can install a compact Vulkan-accelerated `stable-diffusion.cpp` runtime for Stable Diffusion image generation and Wan video generation. The runtime and chosen model weights are downloaded on demand.
- Live CPU, RAM, GPU, and VRAM usage in the sidebar resource monitor. Image and video diffusion weights are explicitly assigned to Vulkan GPU memory.
- Settings for model behavior, memory, startup, and the active system prompt.
- Check compatibility on installed Orion-managed conversational model cards in Models → Manage. Requires the managed llama.cpp engine. Orion diagnoses compatibility and, when available, downloads and validates a newer official runtime for that model. Verified runtime profiles are applied automatically; unsupported models receive a clear explanation. Compatibility errors during chat trigger the same check automatically, with progress shown in the chat tool activity. New architectures still require implementation support in llama.cpp.
- In-app release checks with download progress. Updates open the visible Windows installer or Linux system package installer, then close Orion. Portable Windows and AppImage updates open the downloaded version after Orion closes. Packages stay in Downloads, and release notes appear when the updated version starts.

## Conversation memory — 0.2.0 preview

- **Checkpoint timeline:** preview saved states with a horizontal slider and continue from one in a new branch, preserving the original conversation.
- **Assumption checkpoints:** inspect inferred versus user-stated constraints, confirm or correct them, and review answers and Canvas documents produced under an outdated assumption.
- **Memory lenses:** control conversation, named-project, personal, or all-conversation recall; pin or exclude specific memories and inspect automatically recalled snippets on each answer.
- **Reviewed carry-forward:** edit an evidence packet of decisions, constraints, memories, open questions, and selected Canvas documents before starting a shorter continuation.
- **Branch comparison:** compare message counts, memories, assumptions, carried decisions, and Canvas revisions across alternate paths.

All five use OrionFS locally. Checkpoints preserve application context rather than model hidden state, and do not reverse external actions. Branches use isolated memory snapshots. See the [conversation memory guide](docs/memory-history.md) for workflows, context limits, and deletion behavior. These packages have not been published yet.

## Local voice — 0.2.0 preview

Use the microphone beside Send for live English dictation. Click Send, press Enter, or pause and say exactly **send the message**. The separate speaker toggle enables natural neural read aloud; Settings → Voice offers six American/British voices, speed control, and previews.

The native runtime and relevant model download only after first-use setup is accepted. Dictation and read aloud install independently and work offline afterward. Raw audio stays in memory, without recordings or separate transcript logs. Sent text uses normal encrypted chat history. Voice conversations stay on local models with local tools; voice-derived memories are excluded from ordinary and hosted-provider recall. See the [local voice guide](docs/local-voice.md) for setup, privacy boundaries, and current English support.

## Requirements

For normal use, connect Orion to a local Ollama server with a chat model installed, install an Orion-managed GGUF model, or configure an API provider. API providers receive the prompts sent to them and relevant recalled memories.

Orion Create uses `stable-diffusion.cpp` directly, without a Python environment or node-graph server. The Models browser is limited to supported Stable Diffusion image checkpoints and Wan video bundles. Create downloads its native Vulkan runtime on first use; generation needs additional disk space for model weights and a working Vulkan-capable graphics driver.

## Development

Install [Bun](https://bun.sh/) 1.4.3 or later, then run:

```sh
bun install --frozen-lockfile
bun run dev
```

Useful commands:

```sh
bun run typecheck
bun run build
bun run test
bun run dist
```

`bun run dist` packages for the current platform. The Linux `build.sh` script builds AppImage, `.deb`, and `.rpm` packages in a Podman container. Windows packaging uses `bun run dist`. Release checksums are provided in `SHA256SUMS`.

## Data and privacy

Orion stores conversations, settings, OrionFS memories, downloaded models, and generated media in the operating system's per-user application data directory. Conversations, settings, OrionFS memories, checkpoint histories, assumption records, carry-forward packets, and provider API keys are encrypted at rest with AES-GCM. The encryption key is protected by the operating system's secure storage; Orion decrypts records while reading them and writes them back encrypted. The active OrionFS database is re-encrypted after it has been idle and when Orion exits cleanly. Existing conversation, settings, provider, and memory data is migrated as it is read. Linux requires a working desktop keyring such as GNOME Keyring, KWallet, or Secret Service.

Downloaded model files and generated media files are stored locally but are not encrypted at rest. Local Ollama, llama.cpp, and `stable-diffusion.cpp` inference run on the computer. If you choose a hosted API provider, that provider receives the prompts and relevant memory needed for the request. Web search, model downloads, and initial `stable-diffusion.cpp`, llama.cpp, or explicitly enabled local voice setup use the network. Speech recognition and neural read aloud run locally; microphone audio and synthesized audio are not uploaded or saved as recordings. Voice-derived chat text follows the additional local-only boundaries in the [voice guide](docs/local-voice.md).

API keys are stored in a separate local file with restricted file permissions and are encrypted at rest. File attachments are read after you select them. Orion's tools may access the web or local applications when used in chat.

Orion checks this repository's latest release to provide in-app updates. This check sends no user data and collects none. Orion does not collect telemetry about how the app is used. There are no accounts, fees, or paywalls, now or ever.

## License

Orion is distributed under the MIT License. See [LICENSE](LICENSE).
