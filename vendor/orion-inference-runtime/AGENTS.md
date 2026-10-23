# Orion Inference contributor notes

This directory contains Orion's locally maintained inference runtime source. The executable shipped by Orion is named `orion-inference`; app integration, model lifecycle, packaging, and runtime behavior are defined by the Orion repository.

- Follow the root `AGENTS.md` and `ORION.md` before changing this directory.
- Keep runtime changes compatible with Orion's build scripts and loopback API contract.
- Preserve third-party copyright notices and license files that apply to vendored or derived components.
- Do not add network listeners or hidden shell/tool execution to the managed runtime.
- Verify changes with the repository's existing build and typecheck workflows when requested.
