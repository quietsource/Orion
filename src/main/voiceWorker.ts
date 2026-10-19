// Audio and speech text stay in this isolated native utility process. Never log either.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

type Port = {
  on(
    name: "message",
    callback: (event: {
      data: { id: number; method: string; args: any[] };
    }) => void,
  ): void;
  postMessage(value: unknown): void;
};
const port = (process as typeof process & { parentPort: Port }).parentPort;
let sherpa: any,
  recognizer: any,
  stream: any,
  tts: any,
  resampler: any,
  rate = 16000,
  accent = "";
let root = "";
port.on("message", ({ data: request }) => {
  try {
    let result: unknown;
    const [value, extra, third] = request.args;
    if (request.method === "init") {
      root = value;
      const load = createRequire(
        path.join(root, "runtime-1.13.8", "sherpa-onnx-node", "package.json"),
      );
      sherpa = load("./sherpa-onnx.js");
      if (extra === "dictation") {
        const model = path.join(root, "dictation");
        recognizer = new sherpa.OnlineRecognizer({
          featConfig: { sampleRate: 16000, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: path.join(
                model,
                "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
              ),
              decoder: path.join(
                model,
                "decoder-epoch-99-avg-1-chunk-16-left-128.onnx",
              ),
              joiner: path.join(
                model,
                "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
              ),
            },
            tokens: path.join(model, "tokens.txt"),
            numThreads: 2,
            provider: "cpu",
            debug: 0,
          },
          decodingMethod: "modified_beam_search",
          maxActivePaths: 4,
          enableEndpoint: true,
          rule1MinTrailingSilence: 2.4,
          rule2MinTrailingSilence: 1.1,
          rule3MinUtteranceLength: 24,
        });
        stream = recognizer.createStream();
      }
      result = true;
    } else if (request.method === "reset") {
      stream = recognizer.createStream();
      stream.acceptWaveform({
        samples: new Float32Array(3200),
        sampleRate: 16000,
      });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      resampler = undefined;
      result = true;
    } else if (request.method === "accept" || request.method === "finish") {
      if (request.method === "accept") {
        let samples = value as Float32Array;
        if (extra !== 16000) {
          if (!resampler || rate !== extra) {
            rate = extra;
            resampler = new sherpa.LinearResampler(rate, 16000);
          }
          samples = resampler.resample(samples);
        }
        stream.acceptWaveform({ samples, sampleRate: 16000 });
      } else {
        stream.acceptWaveform({
          samples: new Float32Array(8000),
          sampleRate: 16000,
        });
        stream.inputFinished();
      }
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const text = String(recognizer.getResult(stream).text ?? "").trim();
      const final =
        request.method === "finish" || recognizer.isEndpoint(stream);
      if (final) recognizer.reset(stream);
      result = { text, final };
    } else if (request.method === "speak") {
      const voice = extra as { speaker: number; accent: string },
        model = path.join(root, "speech");
      if (!tts || accent !== voice.accent) {
        const filename = fs
          .readdirSync(model)
          .find((file) => /^model.*\.onnx$/.test(file));
        if (!filename) throw Error("The voice model is incomplete.");
        tts = new sherpa.OfflineTts({
          model: {
            kokoro: {
              model: path.join(model, filename),
              voices: path.join(model, "voices.bin"),
              tokens: path.join(model, "tokens.txt"),
              dataDir: path.join(model, "espeak-ng-data"),
              lexicon: path.join(model, `lexicon-${voice.accent}-en.txt`),
            },
            numThreads: 2,
            provider: "cpu",
            debug: 0,
          },
          maxNumSentences: 1,
        });
        accent = voice.accent;
      }
      const audio = tts.generate({
        text: value,
        enableExternalBuffer: false,
        generationConfig: new sherpa.GenerationConfig({
          sid: voice.speaker,
          speed: third,
          silenceScale: 1.0,
        }),
      });
      // Copy the native external buffer before its owner is collected.
      result = {
        samples: new Float32Array(audio.samples),
        sampleRate: audio.sampleRate,
      };
    } else throw Error("Unsupported voice operation.");
    port.postMessage({ id: request.id, result });
  } catch (error) {
    port.postMessage({
      id: request.id,
      error:
        error instanceof Error
          ? error.message
          : "The local voice engine failed.",
    });
  }
});
