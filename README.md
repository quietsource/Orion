# Orion Tauri 0.2.5 Nightly

Nightly Tauri v2 conversion of Orion, based on the 0.2.0 application. The original source in the parent directory is unchanged.

## Architecture

Tauri owns windows, tray, dialogs, OS credential storage, browser webviews and process supervision. A standalone compiled Bun service provides existing backend logic, OFS SQLite workers and native voice workers. End users need no Bun, Node.js or npm installation. The existing UI and features are retained.

## Development

Install Bun 1.4.3+, Rust/MSVC, C++ build tools and WebView2. Run from this directory:

```powershell
bun install
bun run dev
```

Subsequent launches can use `bun run start` after building once. No Vite or Electron runtime is used.

## Packaging

Run `bun run dist`. Windows produces an NSIS setup EXE, a self-extracting portable EXE and a portable ZIP under `release/0.2.5`. Linux targets DEB, RPM and AppImage when built on Linux. Linux needs WebKitGTK 4.1, AppIndicator, librsvg, OpenSSL, libsecret, D-Bus and a working desktop Secret Service. macOS is not supported.

Distribute the setup EXE, portable EXE, or complete portable ZIP; never distribute the bare native host EXE: the Bun service is a separate bundled executable. Update assets must contain Tauri in their names. The packaging script applies that name and generates SHA256SUMS, preventing this edition from installing Electron releases.

## Existing Orion data

This edition uses the existing orion-local-ai per-user application data directory, including its conversations, models, engines, voices, settings and OFS database. Existing Electron encryption keys are unlocked in place without replacing them. Conversations, settings, API keys and OFS payloads remain encrypted with AES-256-GCM and an OS-protected root key. Models and generated media are unencrypted. Existing network and local inference behavior is retained.

## MCP servers

Orion can connect regular chat to Model Context Protocol servers over local stdio processes or Streamable HTTP. Add and manage servers in **Settings → MCP servers**; servers start disabled, and only tools explicitly enabled for a server are sent to the model. The **MCP** control in the composer lets you enable or disable configured servers and their discovered tools immediately. Those choices are saved in Orion's encrypted settings, including custom headers and environment values.

Local stdio MCP processes run as the current operating-system user and inherit the access of that process; connect only servers you trust. Remote endpoints require HTTPS, while plain HTTP is limited to loopback. MCP tools can have side effects, so enable only the tools you intend to expose. Belt Agents do not receive MCP tools: their private workspace and narrowly brokered, individually approved public-page fetch remain separate from general MCP capabilities.

Run `bun run verify:source` to verify the recorded original source hashes. All conversion files and test fixtures remain in this child folder. See MIGRATION.md for validation details.
