/** Lossless transport for audio buffers and optional arguments across Tauri IPC. */
export function pack(value: any): any {
  if (value === undefined) return { $orion: 'undefined' };
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
      text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { $orion: value instanceof Float32Array ? 'f32' : 'u8', data: btoa(text) };
  }
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pack(item)]));
  return value;
}
export function unpack(value: any): any {
  if (value?.$orion === 'undefined') return undefined;
  if (value?.$orion === 'f32' || value?.$orion === 'u8') {
    const text = atob(value.data), bytes = Uint8Array.from(text, char => char.charCodeAt(0));
    return value.$orion === 'f32' ? new Float32Array(bytes.buffer) : bytes;
  }
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  return value;
}
