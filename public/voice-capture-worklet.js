// Capture only while the microphone control is enabled. No network or storage.
class OrionVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.round(sampleRate * 0.2));
    this.offset = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        if (this.offset)
          this.port.postMessage(this.buffer.slice(0, this.offset));
        this.port.postMessage({ stopped: true });
        this.active = false;
      }
    };
  }
  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let value = 0;
      for (const channel of channels) value += channel[index];
      this.buffer[this.offset++] = value / channels.length;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(this.buffer.length);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("orion-voice-capture", OrionVoiceCapture);
