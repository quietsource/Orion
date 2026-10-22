# Orion Inference source guide

Orion Inference is the locally managed runtime bundled by Orion. Its command-line executable is built as `orion-inference` and launched by Orion's native backend. The app communicates with it through a loopback-only OpenAI-compatible API.

When editing this source, preserve model loading behavior and Orion's packaging contract. Do not add cloud calls, public listeners, or unreviewed execution interfaces. Keep all applicable third-party license and copyright notices intact.

See `ORION.md` for the build integration and the repository root for supported packaging commands.
