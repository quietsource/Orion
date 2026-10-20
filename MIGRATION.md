# Tauri conversion validation

## Platform mapping

| Behavior | Implementation |
| --- | --- |
| Windows, titlebar, resize | Tauri native commands |
| IPC | Typed frontend bridge and private stdio RPC |
| Backend | Standalone Bun executable |
| OFS | Existing SQLite memory engine in Bun workers |
| Voice | Native model bindings in Bun child processes |
| Storage | OS credential store root key, existing AES-GCM payloads |
| Browser | Native child webviews with isolated permissions |
| Tray and exit | Native events and graceful backend cleanup |
| Updates | Existing installer workflow restricted to Tauri assets |

## Verified on Windows

- Cold start initializes theme, chat and live monitor without reload.
- Original UI, liquid-metal artwork, composer and settings render in WebView2.
- Real managed llama.cpp Qwen3-0.6B inference streams and completes.
- Tool execution/status events cross the native bridge.
- Local speech returns non-silent Float32 audio at 24 kHz; dictation accepts audio frames and returns text.
- OFS captures memory; checkpoints, branches and comparison preserve snapshots.
- Canvas reads a synthetic local document.
- Browser tabs are native child webviews inside the right Canvas sidebar, with navigation, title/history state, page extraction tools and isolated remote permissions. Documents and browser are separate Canvas views; no separate browser window is created.
- Real SDXL generation completes with Vulkan and progress events.

Initial checks use isolated synthetic profiles. The existing Windows Orion profile was then opened successfully: five conversations, five installed models, the installed llama.cpp and diffusion engines, installed voices and 279 OFS memories were recognized without setup. Its encryption key is preserved.

## Validation limits

Windows setup/portable packages and Linux AppImage, DEB and RPM packages are built for the 0.2.5 nightly. Linux desktop behavior still requires a runtime check. The retained Wan video pipeline has not yet run end to end in this copy. Voice quality remains that of the existing downloaded models. Published Electron assets are excluded from this edition's updater.

## Diagnostics

For debug builds, set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9224 and use scripts/cdp.mjs. Never enable remote debugging in shipped launchers. ORION_TAURI_DATA_DIR selects an isolated test profile.
