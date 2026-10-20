# Orion Tauri 2.5.0 Nightly

This nightly introduces Orion's Tauri v2 desktop application, with the existing Orion interface and features backed by a standalone Bun service.

- Reuses the existing Orion data directory, conversations, encrypted settings and API keys, OrionFS memories, installed models, managed llama.cpp and diffusion engines, and local voice setup.
- Unlocks the existing Windows encryption key in place; no reinstallation or data import is needed.
- Moves Orion Browser into the right Canvas sidebar with visible tabs, address/navigation controls, keyboard shortcuts and AI page-reading tools.
- Retains local chat, streaming tools, web search, native graphs, Canvas documents, conversation history, local dictation/read aloud, and Vulkan image/video generation.
- Uses native Tauri windows, tray, dialogs and process supervision.

## New in this nightly: Orion-managed ExLlamaV2

- The startup engine panel now offers two managed engines: llama.cpp for GGUF models and ExLlamaV2 for EXL2 models. Either or both can be installed; the model browser also installs either engine later.
- The ExLlamaV2 installer detects the NVIDIA GPU and driver, then installs the matching prebuilt ExLlamaV2 wheel, PyTorch build and CUDA tier into a private managed Python environment (cu128, cu124, cu121 or cu118). Non-NVIDIA devices keep using llama.cpp and are told why.
- Model browser results carry engine tags: #llama.cpp for GGUF, #exllamav2 for EXL2, and both when a repository serves both formats. Engine chips switch the conversational listing between formats.
- EXL2 repositories list each bpw quantization branch as a complete bundle with total size; downloading verifies every file's SHA-256 and installs it as one model. Installed EXL2 models appear in the chat model selector, run through the ExLlamaV2 server with the model's own chat template, support the compatibility check, and unload/reload around image and video generation exactly like GGUF models.
- EXL2 models use Orion's text-based tool protocol in this nightly and do not accept image attachments.

## Downloads

- Windows x64: setup EXE or portable EXE.
- Linux x64: AppImage, DEB or RPM.
- macOS is not currently supported.

This is a prerelease for testing. Linux desktop behavior, legacy Linux keyring migration, and full Wan video generation need further runtime validation. The packaged application was not launched during nightly packaging. Previously checked Windows paths include existing-profile access, llama.cpp streaming, browser tools in Canvas, voice, OFS history/branches and SDXL Vulkan generation.

The existing stable Orion release remains available. This nightly does not replace the stable release or change the original Electron source.
