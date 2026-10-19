export type VoiceKind = "dictation" | "speech";
export const VOICES = [
  {
    id: "heart",
    name: "Heart",
    detail: "American English · feminine",
    speaker: 3,
    accent: "us",
  },
  {
    id: "bella",
    name: "Bella",
    detail: "American English · feminine",
    speaker: 2,
    accent: "us",
  },
  {
    id: "sarah",
    name: "Sarah",
    detail: "American English · feminine",
    speaker: 9,
    accent: "us",
  },
  {
    id: "michael",
    name: "Michael",
    detail: "American English · masculine",
    speaker: 16,
    accent: "us",
  },
  {
    id: "emma",
    name: "Emma",
    detail: "British English · feminine",
    speaker: 21,
    accent: "gb",
  },
  {
    id: "george",
    name: "George",
    detail: "British English · masculine",
    speaker: 26,
    accent: "gb",
  },
] as const;
export interface VoicePreferences {
  voice: string;
  speed: number;
  setupPairSeen?: boolean;
}
export interface VoiceState {
  dictationInstalled: boolean;
  speechInstalled: boolean;
  preferences: VoicePreferences;
}
export interface VoiceProgress {
  kind: VoiceKind;
  phase: "download" | "extract" | "ready" | "error";
  detail: string;
  received: number;
  total: number;
}
export interface DictationResult {
  text: string;
  final: boolean;
}
export interface VoiceAPI {
  state(): Promise<VoiceState>;
  preferences(value: VoicePreferences): Promise<VoicePreferences>;
  setup(kind: VoiceKind): Promise<void>;
  cancelSetup(): Promise<void>;
  start(): Promise<string>;
  accept(
    session: string,
    samples: Float32Array,
    sampleRate: number,
  ): Promise<DictationResult>;
  stop(session: string, flush: boolean): Promise<DictationResult>;
  speak(
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ samples: Float32Array; sampleRate: number }>;
  stopSpeech(): Promise<void>;
  onProgress(callback: (value: VoiceProgress) => void): () => void;
}
