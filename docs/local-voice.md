# Local voice in Orion 0.2.0

Orion provides independent **microphone** and **speaker** controls in the composer. Speech recognition and neural speech synthesis run on the computer, in separate native processes. Orion does not use the browser's cloud speech-recognition service or its system text-to-speech voices.

## Speak a message

1. Click the microphone immediately to the left of Send.
2. On first use, review the local setup explanation and choose **Download and enable**. Orion downloads its native runtime and an English streaming recognition model. Grant microphone permission when requested.
3. Speak. Recognized text appears live in the composer.
4. Click Send, press Enter, or pause briefly and say exactly **send the message** as a separate utterance. Similar phrases do not send a message. The command itself is not added to the draft.

Click the microphone again to stop. Typing into the draft pauses dictation so recognition cannot overwrite your edits. The microphone pauses while the model responds and while speech plays, then resumes when appropriate if voice mode is still enabled. Switching conversations, hiding Orion, or closing the app stops capture.

Current dictation is **English**. A working microphone is required. If the computer cannot process audio in real time, Orion stops capture and preserves the current draft instead of building an unbounded audio backlog.

## Hear the answer

Click the speaker icon beside the microphone to enable read aloud. It is independent of dictation: you can type a message and hear an answer, or dictate without hearing speech.

The first activation downloads the Kokoro neural voice model after you accept setup. Read aloud speaks the latest completed answer when enabled and subsequent completed answers. It reads prose rather than hidden reasoning, raw tool payloads, code fences, or OGS data. Turning the speaker off stops playback and pending synthesis immediately. Read aloud starts off when Orion launches.

In **Settings → Voice**, choose Heart, Bella, Sarah, Michael, Emma, or George, adjust speed, and preview the selected voice. The choices include American and British English voices. They share one neural model; choosing a different voice does not download another model. Opening settings or selecting a voice does not install anything. Previewing is an explicit use and offers setup if needed.

## Downloads and native runtime

- Shared runtime: sherpa-onnx 1.13.8, downloaded only when a voice component is first enabled.
- Dictation: quantized streaming Zipformer English model, about 44 MB of model files.
- Read aloud: Kokoro 1.0 quantized neural voice bundle, about 132 MB compressed.

The two model components install independently. Dictation does not download the neural voices; read aloud does not download recognition weights. Downloads use HTTPS, pinned versions and integrity checks. Incomplete setup is cleaned up and can be retried. After setup, recognition and synthesis need no network connection. No separate Node.js, npm, Python, or speech application is required. Current supported platforms are Windows x64 and Linux x64.

The native speech workers keep inference off the UI thread. Dictation releases its native process when stopped. Speech weights unload after an idle interval or when playback is cancelled, and both workers stop when Orion closes.

## Privacy boundaries

Microphone samples and synthesized audio are held in memory. Orion does not create audio recordings, separate transcript logs, or speech telemetry. Speech text and audio are not uploaded to a speech service. Third-party voice-worker diagnostic output is not forwarded into Orion's logs.

Text you choose to send is an ordinary chat message: it is stored in Orion's encrypted conversation history and can become an OrionFS memory. Voice-derived conversations remain local-only, including their branches and reviewed carry-forward packets. They cannot be sent to hosted API providers or Ollama cloud-backed models. Network tools are unavailable in those conversations. Ordinary conversations do not automatically recall voice-derived memories; they stay within local-only voice conversations. This prevents voice content from silently reaching hosted requests through memory recall.

Read aloud can also synthesize the output of a normally typed hosted-provider conversation locally. That does not change how the original typed request was handled by the selected provider. It does not send the answer to a speech provider.

Small encrypted provenance identifiers enforce these privacy boundaries even after a source conversation is deleted. They contain message identifiers, not audio or transcript text. Model/runtime downloads contact the model hosts for files; no microphone audio or dictated content is attached to download requests.

## Engine references

- [sherpa-onnx native speech engine](https://github.com/k2-fsa/sherpa-onnx)
- [Kokoro voices and speaker mappings](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html)
- [Streaming Zipformer model](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17)
