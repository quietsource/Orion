# Bun and Electron

Orion uses Bun 1.4.3 for package installation, CLI execution, TypeScript checking, bundling, tests, and packaging. `bun.lock` is the dependency lockfile. The build commands use `bunx --bun` so Bun runs JavaScript CLIs even when their shebang requests Node. `bun run dist` packages the desktop app and writes its checksums.

The built desktop app still includes Electron's Node-based main-process runtime. Electron's `BrowserWindow`, IPC, preload, tray, and native APIs run inside Electron, so replacing that runtime with Bun is not possible while keeping Electron. A system Node.js installation is not required to work on Orion; Electron supplies the Node runtime inside the app bundle. `--target=node` in the Bun bundler means the output uses APIs supported by Electron's runtime; it does not invoke a system Node executable.

The electron-builder configuration skips native dependency rebuilds. Orion's current native package, `@napi-rs/canvas`, ships a Windows N-API prebuilt binary. Electron-builder's default sequential rebuilder fails under Bun while resolving its Node-specific helper, so the build packages the prebuilt dependency as installed.

Electrobun is a separate desktop framework that supports Bun as a main-process runtime. It is not a Bun runtime plug-in for Electron, and Orion remains on Electron.
