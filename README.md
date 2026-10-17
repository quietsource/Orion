# Orion

Orion is a local-first desktop app for chatting with AI models, using research and productivity tools, and creating images and video. The current release is `0.1.5`.

Orion is built with Electron and TypeScript. Bun is used to install dependencies, run development commands, build, and package Orion. Electron includes the runtime needed by the desktop app, so a separate system Node.js installation is not required.

## Platform support

- **Windows x64:** supported. The release provides a setup installer and a portable executable.
- **Linux x64:** supported. The release provides AppImage, Debian (`.deb`), and RPM packages.
- **macOS:** not currently supported. Orion does not provide supported macOS builds or installers.

Download the current packages from [GitHub Releases](https://github.com/quietsource/Orion/releases).

## What Orion includes

- Chat with models from a local Ollama server, Orion-managed GGUF models using llama.cpp, or a configured OpenAI-compatible API provider.
- Streamed answers and model-provided reasoning when the selected model and provider support it.
- Conversation history, per-conversation Canvas content, file attachments, Markdown rendering, and live syntax highlighting.
- OrionFS (OFS) local memory. OFS stores attributed statements and their associations locally and recalls relevant memories without a separate embedding model or network service. Memory controls and saved memories are available in Settings.
- General chat tools for web search and page reading, local application actions, questions, and Canvas. Tools run without per-action approval prompts. Project workspace tools are currently disabled.
- Orion Browser controls for opening and reading HTTPS pages in Orion's browser.
- Orion Create, which can install a compact Vulkan-accelerated `stable-diffusion.cpp` runtime for Stable Diffusion image generation and Wan video generation. The runtime and chosen model weights are downloaded on demand.
- Live CPU, RAM, GPU, and VRAM usage in the sidebar resource monitor. Image and video diffusion weights are explicitly assigned to Vulkan GPU memory.
- Settings for model behavior, appearance, memory, startup, and the active system prompt.
- In-app release checks with download progress. Updates open the visible Windows installer or Linux system package installer, then close Orion. Portable Windows and AppImage updates open the downloaded version after Orion closes. Packages stay in Downloads, and release notes appear when the updated version starts.

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

Orion stores conversations, settings, OrionFS memories, downloaded models, and generated media in the operating system's per-user application data directory. Conversations, settings, OrionFS memories, and provider API keys are encrypted at rest with AES-GCM. The encryption key is protected by the operating system's secure storage; Orion decrypts records while reading them and writes them back encrypted. The active OrionFS database is re-encrypted after it has been idle and when Orion exits cleanly. Existing conversation, settings, provider, and memory data is migrated as it is read. Linux requires a working desktop keyring such as GNOME Keyring, KWallet, or Secret Service.

Downloaded model files and generated media files are stored locally but are not encrypted at rest. Local Ollama, llama.cpp, and `stable-diffusion.cpp` inference run on the computer. If you choose a hosted API provider, that provider receives the prompts and relevant memory needed for the request. Web search, model downloads, and initial `stable-diffusion.cpp` or llama.cpp setup use the network.

API keys are stored in a separate local file with restricted file permissions and are encrypted at rest. File attachments are read after you select them. Orion's tools may access the web or local applications when used in chat.

Orion checks this repository's latest release to provide in-app updates. This check sends no user data and collects none. Orion does not collect telemetry about how the app is used. There are no accounts, fees, or paywalls, now or ever.

## License

Orion is distributed under the MIT License. See [LICENSE](LICENSE).
