import { utilityProcess, type UtilityProcess } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readEncryptedText, writeEncryptedText } from "./secure-storage";
import {
  VOICES,
  type VoiceKind,
  type VoicePreferences,
  type VoiceProgress,
  type VoiceState,
  type DictationResult,
} from "../shared/voice";
const execute = promisify(execFile);
const VERSION = "1.13.8";
const MODELS = {
  dictation: "gigaspeech-streaming-2023-06-26-v2",
  speech: "kokoro-1.0-fp32-v2",
};
const PACKAGES = {
  "sherpa-onnx-node":
    "MsDMBdhLFTZ1GwvcGSSQhnS7g/EA8OMH6IYysCVUOM7j8Icty9KRc0E6YT1A5fWBsZwRfKOeh88QC95aRvS8ag==",
  "sherpa-onnx-win-x64":
    "oZF1c9VPOKtMwn83Bboc5XSWL+76BRoyB3eUuVnCknBKxwSULZU2Foia9VHWzU+n4I12rPsP6z6H9Rp1hD9o8g==",
  "sherpa-onnx-linux-x64":
    "6plnhjagsSeTntCgnlag86hWbs/uZE9Crms1LgOb68/1nKsIQjMd+WG519m+aPwT6TrsBOiEMzrx41t8sL5L5g==",
};
const ASR_REPO = "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26";
const ASR_REV = "672fbf1b30579d6585301139bb363f42a0ad4a24";
const ASR_FILES = [
  [
    "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
    "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1",
  ],
  [
    "decoder-epoch-99-avg-1-chunk-16-left-128.onnx",
    "7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef",
  ],
  [
    "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
    "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297",
  ],
  [
    "tokens.txt",
    "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
  ],
] as const;
class NativeVoice {
  private child: UtilityProcess;
  private serial = 0;
  private ended = false;
  private exitResolve = () => {};
  private exited = new Promise<void>((resolve) => {
    this.exitResolve = resolve;
  });
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(worker: string, root: string, onExit: () => void) {
    const native = path.join(
      root,
      `runtime-${VERSION}`,
      `sherpa-onnx-${process.platform === "win32" ? "win" : "linux"}-x64`,
    );
    this.child = utilityProcess.fork(worker, [], {
      serviceName: "Orion local voice",
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${native}${path.delimiter}${process.env.PATH ?? ""}`,
        LD_LIBRARY_PATH: `${native}${path.delimiter}${process.env.LD_LIBRARY_PATH ?? ""}`,
      },
    });
    // Do not forward third-party diagnostics: they may contain transcript text.
    this.child.stdout?.on("data", () => {});
    this.child.stderr?.on("data", () => {});
    this.child.on(
      "message",
      (message: { id: number; result?: unknown; error?: string }) => {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(
            new Error(
              "The local voice engine could not process this audio or text. Try stopping and starting voice again.",
            ),
          );
        else pending.resolve(message.result);
      },
    );
    this.child.on("exit", () => {
      this.ended = true;
      this.exitResolve();
      this.rejectAll(
        "The local voice engine stopped. Activate voice again to restart it.",
      );
      onExit();
    });
  }
  call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.ended)
      return Promise.reject(
        Error(
          "The local voice engine stopped. Activate voice again to restart it.",
        ),
      );
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("The local voice engine timed out."));
        this.close();
      }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.postMessage({ id, method, args });
    });
  }
  private rejectAll(message: string) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error(message));
    }
    this.pending.clear();
  }
  close() {
    this.ended = true;
    this.rejectAll("Local voice processing was stopped.");
    this.child.kill();
    return this.exited;
  }
}
export class VoiceManager {
  private engines: Partial<Record<VoiceKind, Promise<NativeVoice>>> = {};
  private setupTask: Promise<void> | undefined;
  private setupAbort: AbortController | undefined;
  private speechIdle: ReturnType<typeof setTimeout> | undefined;
  private session = "";
  private accepting = false;
  private closed = false;
  private protectedSources: Set<string> | undefined;
  private privacyWrite: Promise<void> = Promise.resolve();
  constructor(
    private root: string,
    private worker: string,
    private progress: (value: VoiceProgress) => void,
  ) {}
  async privateSources() {
    await this.privacyWrite;
    if (!this.protectedSources) {
      try {
        const value = JSON.parse(
          await readEncryptedText(path.join(this.root, "private-sources.enc")),
        ) as string[];
        this.protectedSources = new Set(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw Error(
            "Could not read voice privacy boundaries. Hosted requests are blocked until this is resolved.",
          );
        this.protectedSources = new Set();
      }
    }
    return [...this.protectedSources];
  }
  async protectSources(ids: string[]) {
    await this.privateSources();
    const work = this.privacyWrite.then(async () => {
      let changed = false;
      for (const id of ids)
        if (!this.protectedSources!.has(id)) {
          this.protectedSources!.add(id);
          changed = true;
        }
      if (changed)
        await writeEncryptedText(
          path.join(this.root, "private-sources.enc"),
          JSON.stringify([...this.protectedSources!]),
        );
    });
    this.privacyWrite = work;
    await work;
  }
  private platformPackage() {
    const key = `sherpa-onnx-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
    if (!(key in PACKAGES))
      throw Error("Local voice currently supports Windows x64 and Linux x64.");
    return key as keyof typeof PACKAGES;
  }
  private async exists(target: string) {
    return fs.stat(target).then(
      (value) => value.isFile(),
      () => false,
    );
  }
  private async runtimeReady() {
    const runtime = path.join(this.root, `runtime-${VERSION}`);
    const native = path.join(
      runtime,
      `sherpa-onnx-${process.platform === "win32" ? "win" : "linux"}-x64`,
    );
    return (
      await Promise.all(
        [
          path.join(runtime, "ready.json"),
          path.join(runtime, "sherpa-onnx-node", "sherpa-onnx.js"),
          path.join(native, "sherpa-onnx.node"),
          path.join(
            native,
            process.platform === "win32"
              ? "onnxruntime.dll"
              : "libonnxruntime.so",
          ),
        ].map((file) => this.exists(file)),
      )
    ).every(Boolean);
  }
  private async installed(kind: VoiceKind) {
    if (!(await this.runtimeReady())) return false;
    const folder = path.join(
      this.root,
      kind === "dictation" ? "dictation" : "speech",
    );
    try {
      const ready = JSON.parse(
        await fs.readFile(path.join(folder, "ready.json"), "utf8"),
      ) as { model?: string };
      if (ready.model !== MODELS[kind]) return false;
    } catch {
      return false;
    }
    const files =
      kind === "dictation"
        ? ASR_FILES.map(([name]) => name)
        : [
            "voices.bin",
            "tokens.txt",
            "lexicon-us-en.txt",
            "lexicon-gb-en.txt",
          ];
    if (
      !(
        await Promise.all(
          ["ready.json", ...files].map((file) =>
            this.exists(path.join(folder, file)),
          ),
        )
      ).every(Boolean)
    )
      return false;
    return (
      kind === "dictation" ||
      (await fs.readdir(folder)).some((file) => /^model.*\.onnx$/.test(file))
    );
  }
  async preferences(value?: VoicePreferences): Promise<VoicePreferences> {
    if (value) {
      if (
        !VOICES.some((voice) => voice.id === value.voice) ||
        !Number.isFinite(value.speed) ||
        value.speed < 0.75 ||
        value.speed > 1.35
      )
        throw Error("Choose a listed voice and a speed between 0.75 and 1.35.");
      const previous = await this.preferences();
      const saved = {
        voice: value.voice,
        speed: value.speed,
        setupPairSeen: value.setupPairSeen ?? previous.setupPairSeen ?? false,
      };
      await writeEncryptedText(
        path.join(this.root, "preferences.enc"),
        JSON.stringify(saved),
      );
      return saved;
    }
    try {
      const saved = JSON.parse(
        await readEncryptedText(path.join(this.root, "preferences.enc")),
      ) as VoicePreferences;
      return {
        setupPairSeen: saved.setupPairSeen === true,
        voice: VOICES.some((voice) => voice.id === saved.voice)
          ? saved.voice
          : "heart",
        speed: Number.isFinite(saved.speed)
          ? Math.min(1.35, Math.max(0.75, saved.speed))
          : 1,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("Could not read local voice preferences.");
      return { voice: "heart", speed: 1 };
    }
  }
  async state(): Promise<VoiceState> {
    return {
      dictationInstalled: await this.installed("dictation"),
      speechInstalled: await this.installed("speech"),
      preferences: await this.preferences(),
    };
  }
  async setup(kind: VoiceKind): Promise<void> {
    if (this.closed) throw Error("Orion is closing.");
    if (kind !== "dictation" && kind !== "speech")
      throw Error("Invalid voice component.");
    if (this.setupTask) {
      await this.setupTask;
      if (await this.installed(kind)) return;
    }
    if (await this.installed(kind)) return;
    const previous = this.engines[kind];
    delete this.engines[kind];
    if (previous) await (await previous).close();
    const abort = new AbortController();
    this.setupAbort = abort;
    this.setupTask = this.install(kind, abort.signal).finally(() => {
      this.setupTask = undefined;
      this.setupAbort = undefined;
    });
    return this.setupTask;
  }
  cancelSetup() {
    this.setupAbort?.abort();
  }
  private inside(target: string) {
    const root = path.resolve(this.root);
    if (!path.resolve(target).startsWith(root + path.sep))
      throw Error("Invalid voice installation path.");
    return target;
  }
  private async download(
    url: string,
    target: string,
    algorithm: "sha256" | "sha512",
    digest: string,
    kind: VoiceKind,
    signal: AbortSignal,
  ) {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
      headers: { "user-agent": "Orion-Local-AI" },
    });
    if (!response.ok || !response.body)
      throw Error(`Voice download failed (${response.status}). Retry setup.`);
    const total = Number(response.headers.get("content-length")) || 0,
      hash = createHash(algorithm),
      file = await fs.open(target, "wx", 0o600);
    let received = 0,
      last = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        signal.throwIfAborted();
        received += chunk.byteLength;
        if (received > 800 * 1024 * 1024)
          throw Error("Voice download exceeded its size limit.");
        hash.update(chunk);
        await file.writeFile(chunk);
        if (Date.now() - last > 200) {
          last = Date.now();
          this.progress({
            kind,
            phase: "download",
            detail: "Downloading local voice components",
            received,
            total,
          });
        }
      }
      await file.sync();
    } finally {
      await file.close();
    }
    if (
      (total && received !== total) ||
      hash.digest(algorithm === "sha512" ? "base64" : "hex") !== digest
    )
      throw Error(
        "Voice download did not pass its integrity check. Retry setup.",
      );
  }
  private async extract(archive: string, target: string, signal: AbortSignal) {
    const tar = process.platform === "win32" ? "tar.exe" : "tar";
    const { stdout } = await execute(tar, ["-tf", archive], {
      signal,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    for (const name of stdout.split(/\r?\n/).filter(Boolean)) {
      if (
        name.includes("\\") ||
        path.posix.isAbsolute(name) ||
        name.split("/").includes("..") ||
        /^[a-z]:/i.test(name)
      )
        throw Error("Voice archive contains an unsafe path.");
    }
    await fs.mkdir(target, { recursive: true });
    await execute(tar, ["-xf", archive, "-C", target], {
      signal,
      windowsHide: true,
      timeout: 120_000,
    });
  }
  private async install(kind: VoiceKind, signal: AbortSignal) {
    const platform = this.platformPackage(),
      stage = this.inside(path.join(this.root, `.setup-${randomUUID()}`));
    await fs.mkdir(stage, { recursive: true });
    try {
      if (!(await this.runtimeReady())) {
        const runtime = path.join(stage, "runtime");
        await fs.mkdir(runtime);
        for (const name of ["sherpa-onnx-node", platform] as Array<
          keyof typeof PACKAGES
        >) {
          const archive = path.join(stage, `${name}.tgz`),
            out = path.join(stage, `${name}-extracted`);
          await this.download(
            `https://registry.npmjs.org/${name}/-/${name}-${VERSION}.tgz`,
            archive,
            "sha512",
            PACKAGES[name],
            kind,
            signal,
          );
          await this.extract(archive, out, signal);
          await fs.rename(path.join(out, "package"), path.join(runtime, name));
        }
        await fs.writeFile(
          path.join(runtime, "ready.json"),
          JSON.stringify({ version: VERSION }),
          { mode: 0o600 },
        );
        const target = this.inside(path.join(this.root, `runtime-${VERSION}`));
        await fs.rm(target, { recursive: true, force: true });
        await fs.rename(runtime, target);
      }
      let source: string;
      if (kind === "dictation") {
        source = path.join(stage, "dictation");
        await fs.mkdir(source);
        for (const [file, digest] of ASR_FILES)
          await this.download(
            `https://huggingface.co/${ASR_REPO}/resolve/${ASR_REV}/${file}`,
            path.join(source, file),
            "sha256",
            digest,
            kind,
            signal,
          );
      } else {
        const archive = path.join(stage, "voices.tar.bz2");
        await this.download(
          "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
          archive,
          "sha256",
          "c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298",
          kind,
          signal,
        );
        this.progress({
          kind,
          phase: "extract",
          detail: "Unpacking the local neural voices",
          received: 0,
          total: 0,
        });
        const out = path.join(stage, "voices");
        await this.extract(archive, out, signal);
        const folders = await fs.readdir(out, { withFileTypes: true });
        const folder = folders.find(
          (item) => item.isDirectory() && item.name.startsWith("kokoro"),
        );
        if (!folder)
          throw Error("The neural voice model archive is incomplete.");
        source = path.join(out, folder.name);
        for (const file of [
          "voices.bin",
          "tokens.txt",
          "lexicon-us-en.txt",
          "lexicon-gb-en.txt",
        ])
          if (!(await this.exists(path.join(source, file))))
            throw Error("The downloaded voice model is incomplete.");
      }
      signal.throwIfAborted();
      await fs.writeFile(
        path.join(source, "ready.json"),
        JSON.stringify({ version: 2, model: MODELS[kind] }),
        { mode: 0o600 },
      );
      const target = this.inside(
        path.join(this.root, kind === "dictation" ? "dictation" : "speech"),
      );
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(source, target);
      this.progress({
        kind,
        phase: "ready",
        detail: "Local voice is ready",
        received: 0,
        total: 0,
      });
    } catch (error) {
      this.progress({
        kind,
        phase: "error",
        detail: signal.aborted
          ? "Voice setup cancelled."
          : "Voice setup failed. Retry when connected to the internet.",
        received: 0,
        total: 0,
      });
      throw error;
    } finally {
      await fs
        .rm(this.inside(stage), { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
  private async engine(kind: VoiceKind) {
    if (this.closed) throw Error("Orion is closing.");
    if (!(await this.installed(kind))) throw Error("Set up local voice first.");
    let pending = this.engines[kind];
    if (!pending) {
      pending = (async () => {
        const engine = new NativeVoice(this.worker, this.root, () => {
          if (this.engines[kind] === pending) delete this.engines[kind];
        });
        try {
          await engine.call("init", this.root, kind);
          return engine;
        } catch (error) {
          engine.close();
          throw error;
        }
      })();
      this.engines[kind] = pending;
      pending.catch(() => {
        if (this.engines[kind] === pending) delete this.engines[kind];
      });
    }
    return pending;
  }
  async start() {
    if (this.session) throw Error("A microphone session is already active.");
    const engine = await this.engine("dictation");
    await engine.call("reset");
    return (this.session = randomUUID());
  }
  async accept(
    session: string,
    samples: Float32Array,
    sampleRate: number,
  ): Promise<DictationResult> {
    if (!session || session !== this.session)
      throw Error("Microphone session is no longer active.");
    if (
      !(samples instanceof Float32Array) ||
      !samples.length ||
      !Number.isInteger(sampleRate) ||
      samples.length > sampleRate ||
      sampleRate < 8000 ||
      sampleRate > 96000 ||
      !samples.every(Number.isFinite)
    )
      throw Error("Invalid microphone audio.");
    if (this.accepting)
      throw Error(
        "The microphone is delivering audio faster than it can be processed.",
      );
    this.accepting = true;
    try {
      return await (
        await this.engine("dictation")
      ).call("accept", samples, sampleRate);
    } finally {
      this.accepting = false;
    }
  }
  async stop(session: string, flush: boolean): Promise<DictationResult> {
    if (!session || session !== this.session) return { text: "", final: true };
    this.session = "";
    const pending = this.engines.dictation;
    delete this.engines.dictation;
    if (!pending) return { text: "", final: true };
    const engine = await pending;
    try {
      return flush ? await engine.call("finish") : { text: "", final: true };
    } finally {
      engine.close();
    }
  }
  async speak(text: string, voiceId: string, speed: number) {
    if (typeof text !== "string" || !text.trim() || text.length > 650)
      throw Error("Read-aloud text must be between 1 and 650 characters.");
    const voice = VOICES.find((item) => item.id === voiceId);
    if (!voice || !Number.isFinite(speed) || speed < 0.75 || speed > 1.35)
      throw Error("Invalid read-aloud voice.");
    if (this.speechIdle) clearTimeout(this.speechIdle);
    try {
      return await (
        await this.engine("speech")
      ).call<{ samples: Float32Array; sampleRate: number }>(
        "speak",
        text,
        voice,
        speed,
      );
    } finally {
      this.speechIdle = setTimeout(() => this.stopSpeech(), 60_000);
      this.speechIdle.unref?.();
    }
  }
  stopSpeech() {
    if (this.speechIdle) clearTimeout(this.speechIdle);
    const pending = this.engines.speech;
    delete this.engines.speech;
    void pending?.then((engine) => engine.close()).catch(() => undefined);
  }
  suspend() {
    this.session = "";
    this.stopSpeech();
    const pending = this.engines.dictation;
    delete this.engines.dictation;
    void pending?.then((engine) => engine.close()).catch(() => undefined);
  }
  async close() {
    this.closed = true;
    this.cancelSetup();
    this.session = "";
    this.stopSpeech();
    await Promise.allSettled(
      Object.values(this.engines).map(async (engine) =>
        (await engine)?.close(),
      ),
    );
    this.engines = {};
    await this.setupTask?.catch(() => undefined);
    await this.privacyWrite.catch(() => undefined);
  }
}
