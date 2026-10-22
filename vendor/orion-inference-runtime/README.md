# Orion Inference

Orion Inference is Orion's locally managed inference runtime. Orion builds and bundles the `orion-inference` executable, manages its lifecycle, and exposes it to the desktop app through a loopback-only OpenAI-compatible endpoint.

## Runtime responsibilities

- Run supported conversational models locally, including GGUF, GPTQ, and AWQ artifacts when supported by the selected build and model architecture.
- Keep model discovery and downloads in Orion's model browser.
- Use Orion's detected hardware and runtime configuration when starting a model.
- Keep inference endpoints bound to the local machine; Orion does not expose the server to the network.

Model compatibility depends on architecture, quantization, runtime build features, and available hardware. The format label alone does not guarantee that every model will load.

## Orion build and maintenance

Use the Orion repository scripts and `ORION.md` for the supported build workflow. The desktop application owns runtime installation, updates, model selection, and shutdown. Do not use this directory as a standalone installer or recommend another system-wide runtime.

Third-party notices and licenses shipped with source components are retained in this directory. They remain part of the applicable source and distribution terms.
