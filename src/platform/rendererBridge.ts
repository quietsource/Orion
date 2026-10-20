import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { pack, unpack } from './codec';

const listeners = new Map<string, Set<(...args: any[]) => void>>();
// Register the event receiver before the first backend request to retain stream ordering.
const ready = listen<{ channel: string; args: unknown[] }>('orion:event', event => {
  for (const callback of listeners.get(event.payload.channel) ?? []) callback({}, ...unpack(event.payload.args));
});
export const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]) {
    await ready;
    return unpack(await invoke('orion_invoke', { channel, args: pack(args) }));
  },
  on(channel: string, callback: (...args: any[]) => void) {
    let callbacks = listeners.get(channel);
    if (!callbacks) listeners.set(channel, callbacks = new Set());
    callbacks.add(callback);
  },
  removeListener(channel: string, callback: (...args: any[]) => void) { listeners.get(channel)?.delete(callback); },
};
export function expose(name: string, value: unknown) {
  Object.defineProperty(window, name, { value: Object.freeze(value), writable: false, configurable: false });
}
const droppedFiles = new Map<string, string>();
export const webUtils = { getPathForFile(file: File) { return droppedFiles.get(file.name) ?? ''; } };
void listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', event => {
  for (const file of event.payload.paths) droppedFiles.set(file.split(/[\\/]/).at(-1)!, file);
  document.dispatchEvent(new CustomEvent('orion-native-file-drop', { detail: event.payload }));
});
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.titlebar-drag')?.addEventListener('pointerdown', event => {
    if ((event as PointerEvent).button === 0) void getCurrentWindow().startDragging();
  });
  document.querySelector('.titlebar-drag')?.addEventListener('dblclick', () => void ipcRenderer.invoke('window:action', 'toggle-maximize'));
});
