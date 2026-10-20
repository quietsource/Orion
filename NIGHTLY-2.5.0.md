# Orion Tauri 2.5.0 Nightly

This nightly introduces Orion's Tauri v2 desktop application, with the existing Orion interface and features backed by a standalone Bun service.

- Reuses the existing Orion data directory, conversations, encrypted settings and API keys, OrionFS memories, installed models, managed llama.cpp and diffusion engines, and local voice setup.
- Unlocks the existing Windows encryption key in place; no reinstallation or data import is needed.
- Moves Orion Browser into the right Canvas sidebar with visible tabs, address/navigation controls, keyboard shortcuts and AI page-reading tools.
- Retains local chat, streaming tools, web search, native graphs, Canvas documents, conversation history, local dictation/read aloud, and Vulkan image/video generation.
- Uses native Tauri windows, tray, dialogs and process supervision.

## Downloads

- Windows x64: setup EXE or portable EXE.
- Linux x64: AppImage, DEB or RPM.
- macOS is not currently supported.

This is a prerelease for testing. Linux desktop behavior, legacy Linux keyring migration, and full Wan video generation need further runtime validation. The packaged application was not launched during nightly packaging. Previously checked Windows paths include existing-profile access, llama.cpp streaming, browser tools in Canvas, voice, OFS history/branches and SDXL Vulkan generation.

The existing stable Orion release remains available. This nightly does not replace the stable release or change the original Electron source.
