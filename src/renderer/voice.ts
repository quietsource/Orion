import {
  VOICES,
  type VoiceKind,
  type VoicePreferences,
  type DictationResult,
} from "../shared/voice";
import "./voice.css";
type Host = {
  prompt: HTMLTextAreaElement;
  composer: HTMLElement;
  send(): Promise<void>;
  notice(text: string): void;
  currentId(): string | undefined;
  isGenerating(): boolean;
  prepareConversation(): void;
  latestReply(): { text: string; id: string };
};
const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const microphone = icon(
  '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
);
const speaker = icon(
  '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
);
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}
function button(
  text: string,
  action: () => void | Promise<void>,
  className = "secondary",
) {
  const value = element("button", text, className);
  value.type = "button";
  value.onclick = () => {
    void Promise.resolve()
      .then(action)
      .catch(() => undefined);
  };
  return value;
}

export function installVoice(host: Host) {
  const api = window.orion.voice,
    send = document.getElementById("send")!;
  const speechButton = button("", toggleSpeech, "composer-action voice-button");
  speechButton.innerHTML = speaker;
  speechButton.id = "voice-read";
  speechButton.setAttribute("aria-label", "Enable local read aloud");
  speechButton.setAttribute("aria-pressed", "false");
  speechButton.title = "Read aloud · local neural voices";
  const mic = button("", toggleMicrophone, "composer-action voice-button");
  mic.innerHTML = microphone;
  mic.id = "voice-mic";
  mic.setAttribute("aria-label", "Start local dictation");
  mic.setAttribute("aria-pressed", "false");
  mic.title = "Local voice · microphone";
  send.before(speechButton, mic);
  const status = element("div", "", "voice-status");
  status.hidden = true;
  status.setAttribute("role", "status");
  host.prompt.before(status);
  let preferences: VoicePreferences = { voice: "heart", speed: 1 },
    microphoneEnabled = false,
    readEnabled = false,
    generating = false,
    reading = false,
    starting = false,
    stopping = false,
    internalEdit = false,
    draftPrivate = false;
  let media: MediaStream | undefined,
    capture: AudioContext | undefined,
    worklet: AudioWorkletNode | undefined,
    source: MediaStreamAudioSourceNode | undefined,
    mute: GainNode | undefined;
  let session = "",
    captureGeneration = 0,
    captureConversation = "",
    utteranceBase = "",
    partial = "";
  let drainCapture: Promise<void> = Promise.resolve(),
    resolveDrain: (() => void) | undefined;
  let stopTask: Promise<void> | undefined;
  let queue: Float32Array[] = [],
    queuedSamples = 0,
    pumping: Promise<void> = Promise.resolve(),
    pumpActive = false;
  let readGeneration = 0,
    audioContext: AudioContext | undefined,
    audioSource: AudioBufferSourceNode | undefined,
    finishPlayback: (() => void) | undefined;
  let stateLoaded = false,
    setupBusy = false,
    setupKind: VoiceKind = "dictation",
    setupResolve: ((value: boolean) => void) | undefined,
    setupTask: Promise<boolean> | undefined;
  const setupDialog = element("dialog", undefined, "voice-setup");
  const setupTitle = element("h2"),
    setupText = element("p"),
    setupPrivacy = element(
      "p",
      "Speech processing stays on this computer. Audio exists only in memory. Sent text is saved as ordinary encrypted chat history; no separate voice recordings or transcript logs are created.",
      "muted",
    );
  const download = element("progress");
  download.max = 1;
  download.hidden = true;
  const setupDetail = element("p", "", "voice-setup-detail");
  setupDetail.setAttribute("role", "status");
  const cancel = button("Not now", () => {
    if (setupBusy) {
      void api.cancelSetup();
      return;
    }
    resolveSetup(false);
  });
  const install = button(
    "Download and enable",
    async () => {
      if (setupBusy) return;
      setupBusy = true;
      download.hidden = false;
      download.removeAttribute("value");
      install.disabled = true;
      cancel.textContent = "Cancel download";
      try {
        await api.setup(setupKind);
        resolveSetup(true);
      } catch (error) {
        setupDetail.textContent = message(error);
        setupBusy = false;
        install.disabled = false;
        install.textContent = "Retry setup";
        cancel.textContent = "Close";
        download.hidden = true;
      }
    },
    "primary",
  );
  const setupActions = element("div", undefined, "voice-setup-actions");
  setupActions.append(cancel, install);
  setupDialog.append(
    setupTitle,
    setupText,
    setupPrivacy,
    download,
    setupDetail,
    setupActions,
  );
  document.body.append(setupDialog);
  setupDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (setupBusy) void api.cancelSetup();
    else resolveSetup(false);
  });
  api.onProgress((value) => {
    if (!setupDialog.open || value.kind !== setupKind) return;
    setupDetail.textContent = value.total
      ? `${value.detail} · ${(value.received / 1048576).toFixed(1)} / ${(value.total / 1048576).toFixed(1)} MB`
      : value.detail;
    if (value.total) {
      download.value = value.received / value.total;
    } else download.removeAttribute("value");
  });
  function message(error: unknown) {
    return error instanceof Error
      ? error.message
      : "Local voice could not start. Check your microphone and try again.";
  }
  function update() {
    mic.classList.toggle("active", microphoneEnabled);
    mic.setAttribute("aria-pressed", String(microphoneEnabled));
    mic.setAttribute(
      "aria-label",
      microphoneEnabled ? "Stop local dictation" : "Start local dictation",
    );
    speechButton.classList.toggle("active", readEnabled);
    speechButton.setAttribute("aria-pressed", String(readEnabled));
    speechButton.setAttribute(
      "aria-label",
      readEnabled ? "Disable local read aloud" : "Enable local read aloud",
    );
    const text = starting
      ? "Starting the local microphone…"
      : reading
        ? "Reading aloud locally…"
        : microphoneEnabled
          ? generating
            ? "Voice paused while the model responds"
            : session
              ? "Listening locally · Pause, then say “send the message” to send"
              : "Microphone paused"
          : "";
    status.textContent = text;
    status.hidden = !text;
    mic.disabled = starting || stopping;
  }
  function resolveSetup(value: boolean) {
    setupBusy = false;
    setupDialog.close();
    setupResolve?.(value);
    setupResolve = undefined;
    setupTask = undefined;
  }
  async function ensure(kind: VoiceKind) {
    const state = await api.state();
    preferences = state.preferences;
    stateLoaded = true;
    if (kind === "dictation" ? state.dictationInstalled : state.speechInstalled)
      return true;
    if (setupTask) {
      await setupTask;
      return ensure(kind);
    }
    setupKind = kind;
    setupTitle.textContent =
      kind === "dictation"
        ? "Enable local voice typing"
        : "Enable natural read aloud";
    setupText.textContent =
      kind === "dictation"
        ? "On first use, Orion downloads its native speech engine (about 10 MB) and English streaming recognition model (about 44 MB). After setup, dictation works offline. Nothing is downloaded unless you enable it. Dictated conversations use local chat models and local tools only."
        : "On first use, Orion downloads its native speech engine (about 10 MB) and Kokoro neural voice model (about 132 MB). All six natural voice choices share this model. Speech is generated locally and works offline after setup.";
    setupDetail.textContent = "";
    download.hidden = true;
    install.disabled = false;
    install.textContent = "Download and enable";
    cancel.textContent = "Not now";
    setupTask = new Promise<boolean>((resolve) => (setupResolve = resolve));
    setupDialog.showModal();
    return setupTask;
  }
  async function toggleMicrophone() {
    if (microphoneEnabled) {
      microphoneEnabled = false;
      await stopCapture(true);
      update();
      return;
    }
    try {
      if (!(await ensure("dictation"))) return;
      host.prepareConversation();
      microphoneEnabled = true;
      if (!generating && !reading) await startCapture();
      update();
    } catch (error) {
      microphoneEnabled = false;
      await stopCapture(false);
      update();
      host.notice(message(error));
    }
  }
  async function toggleSpeech() {
    if (readEnabled) {
      readEnabled = false;
      await stopReading();
      update();
      await resumeCapture();
      return;
    }
    try {
      if (!(await ensure("speech"))) return;
      readEnabled = true;
      update();
      const latest = host.latestReply();
      if (latest.text && !host.isGenerating()) await read(latest.text);
    } catch (error) {
      host.notice(message(error));
    }
  }
  function write(text: string) {
    internalEdit = true;
    host.prompt.value = text;
    host.prompt.dispatchEvent(new Event("input", { bubbles: true }));
    internalEdit = false;
  }
  function sentence(text: string) {
    return text ? text[0]!.toUpperCase() + text.slice(1) : "";
  }
  function apply(result: DictationResult) {
    if (captureConversation !== host.currentId()) return;
    const text = result.text.trim();
    // The command must be a complete utterance: related phrases never send.
    const command =
      text
        .toLowerCase()
        .replace(/[.,!?]/g, "")
        .trim() === "send the message";
    if (command) {
      write(utteranceBase);
      partial = "";
      if (
        result.final &&
        utteranceBase.trim() &&
        !document.querySelector("dialog[open]")
      ) {
        queueMicrotask(() => {
          void host.send();
        });
      }
      return;
    }
    partial = sentence(text);
    write(
      [utteranceBase, partial]
        .filter(Boolean)
        .join(utteranceBase && !/\s$/.test(utteranceBase) ? " " : ""),
    );
    if (text) draftPrivate = true;
    if (result.final) {
      utteranceBase = host.prompt.value;
      partial = "";
    }
  }
  async function startCapture() {
    if (
      starting ||
      session ||
      !microphoneEnabled ||
      generating ||
      reading ||
      document.hidden
    )
      return;
    starting = true;
    update();
    const generation = ++captureGeneration;
    try {
      // Permission is requested only after an explicit microphone click.
      media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (generation !== captureGeneration) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      const nextSession = await api.start();
      if (generation !== captureGeneration || !microphoneEnabled) {
        await api.stop(nextSession, false);
        return;
      }
      session = nextSession;
      captureConversation = host.currentId() ?? "";
      utteranceBase = host.prompt.value;
      partial = "";
      queue = [];
      queuedSamples = 0;
      capture = new AudioContext({
        sampleRate: 16000,
        latencyHint: "interactive",
      });
      await capture.audioWorklet.addModule("./voice-capture-worklet.js");
      if (generation !== captureGeneration) return;
      source = capture.createMediaStreamSource(media);
      worklet = new AudioWorkletNode(capture, "orion-voice-capture");
      mute = capture.createGain();
      mute.gain.value = 0;
      source.connect(worklet);
      worklet.connect(mute);
      mute.connect(capture.destination);
      drainCapture = new Promise((resolve) => {
        resolveDrain = resolve;
      });
      worklet.port.onmessage = (event) => {
        if (event.data?.stopped) {
          resolveDrain?.();
          return;
        }
        if (
          generation !== captureGeneration ||
          !session ||
          !(event.data instanceof Float32Array)
        )
          return;
        queue.push(event.data);
        queuedSamples += event.data.length;
        if (queuedSamples > capture!.sampleRate * 4) {
          microphoneEnabled = false;
          void stopCapture(false);
          host.notice(
            "This computer cannot keep up with live dictation. The microphone was stopped; your current draft is preserved.",
          );
          return;
        }
        pump(generation);
      };
      media.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (microphoneEnabled) {
          microphoneEnabled = false;
          void stopCapture(false).then(update);
        }
      });
      await capture.resume();
    } catch (error) {
      microphoneEnabled = false;
      await stopCapture(false);
      throw error;
    } finally {
      starting = false;
      update();
    }
  }
  function pump(generation: number) {
    if (pumpActive) return;
    pumpActive = true;
    pumping = (async () => {
      try {
        while (queue.length && session && generation === captureGeneration) {
          const samples = queue.shift()!;
          queuedSamples -= samples.length;
          const result = await api.accept(
            session,
            samples,
            capture!.sampleRate,
          );
          if (generation === captureGeneration) apply(result);
        }
      } catch (error) {
        if (generation === captureGeneration) {
          microphoneEnabled = false;
          captureGeneration++;
          host.notice(message(error));
          void stopCapture(false).then(update);
        }
      } finally {
        pumpActive = false;
      }
    })();
  }
  function stopCapture(flush: boolean): Promise<void> {
    return (stopTask ??= stopCaptureInternal(flush)
      .catch((error) => {
        host.notice(message(error));
      })
      .finally(() => {
        stopTask = undefined;
      }));
  }
  async function stopCaptureInternal(flush: boolean) {
    stopping = true;
    update();
    const old = session;
    try {
      worklet?.port.postMessage("stop");
      source?.disconnect();
      media?.getTracks().forEach((track) => track.stop());
      if (flush) {
        if (worklet)
          await Promise.race([
            drainCapture,
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
        await pumping;
        if (queue.length && session) {
          pump(captureGeneration);
          await pumping;
        }
      }
      const stoppedGeneration = ++captureGeneration;
      session = "";
      queue = [];
      queuedSamples = 0;
      if (old) {
        const result = await api.stop(old, flush);
        if (flush && stoppedGeneration === captureGeneration) apply(result);
      }
    } finally {
      worklet?.disconnect();
      mute?.disconnect();
      await capture?.close().catch(() => undefined);
      capture = undefined;
      media = undefined;
      worklet = undefined;
      source = undefined;
      mute = undefined;
      partial = "";
      stopping = false;
      update();
    }
  }
  async function resumeCapture() {
    if (microphoneEnabled && !generating && !reading && !session && !starting)
      try {
        await startCapture();
      } catch (error) {
        host.notice(message(error));
      }
  }
  host.prompt.addEventListener("input", () => {
    if (internalEdit) return;
    if (!host.prompt.value.trim()) draftPrivate = false;
    if (session || stopping || starting) {
      ++captureGeneration;
      microphoneEnabled = false;
      void stopCapture(false).then(update);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      microphoneEnabled = false;
      void stopCapture(false);
      void stopReading();
    }
  });
  window.addEventListener("beforeunload", () => {
    media?.getTracks().forEach((track) => track.stop());
    void api.stopSpeech();
    if (session) void api.stop(session, false);
  });
  async function stopReading() {
    ++readGeneration;
    reading = false;
    const stopped = api.stopSpeech(),
      context = audioContext,
      playing = audioSource,
      finish = finishPlayback;
    audioContext = undefined;
    audioSource = undefined;
    finishPlayback = undefined;
    try {
      playing?.stop();
    } catch {}
    finish?.();
    await Promise.all([
      stopped.catch(() => undefined),
      context?.close().catch(() => undefined),
    ]);
    update();
  }
  function speechChunks(markdown: string) {
    // Speak the answer, not hidden reasoning, tool payloads or raw code/graphs.
    const text = markdown
      .replace(/```[\s\S]*?(?:```|$)/g, " ")
      .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/^[\s|:-]+$/gm, " ")
      .replace(/^[#>*\-+]+\s*/gm, "")
      .replace(/[`*_~|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const sentences = text.match(/[^.!?]+(?:[.!?]+(?:\s|$)|$)/g) ?? [text],
      chunks: string[] = [];
    let buffer = "";
    for (const sentence of sentences) {
      for (const piece of sentence.match(/.{1,450}(?:\s|$)|.{1,450}/g) ?? []) {
        if (buffer.length + piece.length > 500) {
          if (buffer.trim()) chunks.push(buffer.trim());
          buffer = "";
        }
        buffer += piece;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks;
  }
  async function read(text: string) {
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const stopped = stopReading(),
      generation = readGeneration;
    await stopped;
    if (generation !== readGeneration) return;
    reading = true;
    update();
    await stopCapture(true);
    if (generation !== readGeneration) return;
    try {
      audioContext = new AudioContext();
      await audioContext.resume();
      for (const chunk of chunks) {
        if (generation !== readGeneration) break;
        const audio = await api.speak(
          chunk,
          preferences.voice,
          preferences.speed,
        );
        if (generation !== readGeneration) break;
        const samples = new Float32Array(audio.samples);
        if (!samples.length) continue;
        const buffer = audioContext.createBuffer(
          1,
          samples.length,
          audio.sampleRate,
        );
        buffer.copyToChannel(samples, 0);
        await new Promise<void>((resolve) => {
          finishPlayback = resolve;
          audioSource = audioContext!.createBufferSource();
          audioSource.buffer = buffer;
          audioSource.connect(audioContext!.destination);
          audioSource.onended = () => {
            if (finishPlayback === resolve) finishPlayback = undefined;
            resolve();
          };
          audioSource.start();
        });
      }
    } catch (error) {
      if (generation === readGeneration) throw error;
    } finally {
      if (generation === readGeneration) {
        reading = false;
        audioSource = undefined;
        await audioContext?.close().catch(() => undefined);
        audioContext = undefined;
        update();
        await resumeCapture();
      }
    }
  }
  function settingsSection() {
    const section = element("div", undefined, "voice-settings");
    const copy = element(
      "p",
      "Dictation and neural read aloud run locally. Components download only when first enabled. English dictation is currently supported. Voice messages stay with local models and local tools.",
      "muted",
    );
    const select = element("select");
    select.setAttribute("aria-label", "Read-aloud voice");
    for (const voice of VOICES)
      select.add(new Option(`${voice.name} · ${voice.detail}`, voice.id));
    const speed = element("input");
    speed.type = "range";
    speed.min = ".75";
    speed.max = "1.35";
    speed.step = ".05";
    speed.setAttribute("aria-label", "Read-aloud speed");
    const speedLabel = element("span", "1.00×");
    const information = element("p", "", "muted");
    const preview = button("Preview voice", async () => {
      preview.disabled = true;
      try {
        if (await ensure("speech"))
          await read(
            "Hello. Welcome to Orion. This is my voice, generated entirely on your computer.",
          );
      } catch (error) {
        information.textContent = message(error);
      } finally {
        preview.disabled = false;
      }
    });
    const stop = button("Stop preview", async () => {
      await stopReading();
      await resumeCapture();
    });
    const voiceLabel = element("label", "Voice");
    voiceLabel.append(select);
    const speedField = element("label", "Speaking speed");
    speedField.append(speed, speedLabel);
    section.append(copy, voiceLabel, speedField, preview, stop, information);
    let saving: Promise<unknown> = Promise.resolve();
    const save = () => {
      const next = { voice: select.value, speed: Number(speed.value) };
      saving = saving
        .then(async () => {
          preferences = await api.preferences(next);
          information.textContent = "Voice preferences saved locally.";
        })
        .catch(() => {
          information.textContent = "Could not save voice preferences.";
        });
    };
    select.onchange = save;
    speed.onchange = save;
    speed.oninput = () => {
      speedLabel.textContent = `${Number(speed.value).toFixed(2)}×`;
    };
    void api
      .state()
      .then((state) => {
        preferences = state.preferences;
        stateLoaded = true;
        select.value = preferences.voice;
        speed.value = String(preferences.speed);
        speedLabel.textContent = `${preferences.speed.toFixed(2)}×`;
        information.textContent = `Dictation ${state.dictationInstalled ? "installed" : "not downloaded"} · Neural voices ${state.speechInstalled ? "installed" : "not downloaded"}. Choosing a voice does not download anything.`;
      })
      .catch(() => {
        information.textContent = "Could not read local voice status.";
      });
    return section;
  }
  update();
  return {
    settingsSection,
    async beforeSend() {
      await stopReading();
      await stopCapture(true);
      return draftPrivate;
    },
    submitted() {
      draftPrivate = false;
      utteranceBase = "";
      partial = "";
    },
    generating(value: boolean) {
      generating = value;
      if (value) {
        void stopCapture(false);
        void stopReading();
      }
      update();
    },
    async reply(text: string, conversationId: string, complete: boolean) {
      generating = false;
      if (conversationId !== host.currentId()) return;
      try {
        if (readEnabled && complete && text.trim()) await read(text);
      } catch (error) {
        host.notice(message(error));
      } finally {
        await resumeCapture();
      }
    },
    changedConversation() {
      microphoneEnabled = false;
      void stopCapture(false).then(update);
      void stopReading();
    },
    resume: resumeCapture,
  };
}
