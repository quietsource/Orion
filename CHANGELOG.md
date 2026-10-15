# Orion 0.1.0 — Initial release

Orion 0.1.0 is the first consolidated public release. This feature list records the capabilities implemented in the project at release time.

## Supported and implemented features

- Local chat with installed Ollama models and Orion-managed GGUF models served by the bundled llama.cpp runtime, with streamed responses and supported reasoning controls.
- Optional cloud chat providers, including OpenAI, Anthropic, Google Gemini, Z.AI, Kimi/Moonshot, OpenRouter, OpenCode Zen, OpenCode Go, and compatible OpenAI-style APIs.
- Conversation history, local settings, searchable long-term memory, semantic recall, and context-window budgeting.
- Optional project workspaces with file search, reading and editing, command execution, approval controls, change review, and recoverable checkpoints. Workspace tools stay scoped to the selected project.
- General Orion tools available without a workspace, including web search and page reading, image and video generation, Canvas, diagrams, and questions for the user.
- Web research that streams search and page-reading activity, stores useful retrieved text in Orion memory, and gives sources to the model before it writes an answer.
- Orion Canvas for Markdown, HTML, PDF, code, office documents, and images, including source and preview modes, copy/download, notes, and AI-assisted revisions.
- File ingestion for text, Markdown, code, PDF, Microsoft Office and OpenDocument files, spreadsheets, and images.
- Orion Create with private ComfyUI installation and local image/video workflows.
- Composer thinking controls, workspace approval mode, attachments, slash and keyboard command palette, and compact expandable tool activity.
- Local research and quality-control subagents, bounded to two concurrent tasks by default and unloaded after use.
- Native Mermaid diagram rendering with validation and correction feedback.
- Renderer hardening: Markdown and Mermaid SVG pass through DOMPurify before insertion, dynamic web-source links are protocol-checked, and untrusted data is inserted as text instead of HTML.

## Platforms

Windows is fully supported and recommended. Linux packages are provided as AppImage, deb, and rpm. macOS packages are built for Intel and Apple Silicon. The 0.1.0 release includes installers for all three operating systems.

## Included in 0.1.0

- Bun 1.4.3 is the project runtime, package manager, and bundler for install, build, test, and packaging commands. Electron remains the desktop runtime and bundles the Node APIs Electron requires; Orion development and packaging do not require a system Node.js installation.
- Experimental OrionFS (OFS) is an opt-in, model-free memory engine with local distributed vectors, attributed statement capture and graph-based recall. It runs in a background worker and displays saved memories in Settings, with its own sidebar resource statistics. Orion Memory remains available with its own archive statistics.
- Cross-platform release packages are available for Windows, Linux, Intel macOS, and Apple Silicon macOS, with checksums for each platform's release assets.
- Orion uses a transparent abstract blue, cyan, and violet application icon, with a distraction-free composer and a hover-revealed collapsed sidebar aligned with Canvas spacing and rounded corners.
- Settings controls are organized into clear, scrollable sections, with the active model's system prompt displayed in its own tab and reliable local preference saving.
- Collapsed sidebars use matching window-edge spacing and blend into the application background; the left sidebar reveals conversation navigation on hover and hides when the pointer leaves.
- Context controls have visible dropdown affordances; streamed replies update in batches while keeping tool panels stable.
- Composer focus is shown with a crisp accent border, and interface surfaces use flat styling without shadow halos.
- Closing Orion with Keep in tray disabled quits the complete application and waits for managed inference server cleanup.
