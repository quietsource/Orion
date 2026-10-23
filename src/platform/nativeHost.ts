import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { nativeCall, setDispatcher, setEventReceiver, writeProtocol } from './serviceTransport';

export { nativeCall };
export type NativeEvent = { defaultPrevented: boolean; preventDefault(): void };
const event = (): NativeEvent => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
export interface InvokeEvent { sender: NativeContents; senderFrame: object }
const windows = new Map<string, NativeWindow>(), contents = new Map<string, NativeContents>();
const windowWaiters = new Map<string, Set<(value: NativeContents) => void>>();
const handlers = new Map<string, (event: InvokeEvent, ...args: any[]) => any>();
export const ipcMain = { handle(channel: string, callback: (event: InvokeEvent, ...args: any[]) => any) {
  if (handlers.has(channel)) throw Error(`Duplicate native channel: ${channel}`);
  handlers.set(channel, callback);
} };
setDispatcher(async request => {
  if (request.window !== 'main') throw Error('Untrusted Orion window.');
  // The OS may load a hidden webview before storage has finished unlocking.
  // Hold early requests until its backend identity exists instead of rejecting init.
  const target = contents.get(request.window) ?? await new Promise<NativeContents>((resolve, reject) => {
    let waiters = windowWaiters.get(request.window);
    if (!waiters) windowWaiters.set(request.window, waiters = new Set());
    const accept = (value: NativeContents) => { clearTimeout(timer); waiters!.delete(accept); resolve(value); };
    const timer = setTimeout(() => { waiters!.delete(accept); reject(Error('Orion is still initializing its local storage.')); }, 45_000);
    waiters.add(accept);
  });
  const handler = handlers.get(request.channel);
  if (!handler) throw Error(`Unknown Orion operation: ${request.channel}`);
  return handler({ sender: target, senderFrame: target.mainFrame }, ...request.args);
});
export class NativeContents extends EventEmitter {
  readonly mainFrame = {};
  readonly id: string;
  private url = '';
  private loading = false;
  private closed = false;
  private back = false;
  private forward = false;
  readonly ready: Promise<unknown>;
  constructor(readonly label: string, ready: Promise<unknown> = Promise.resolve()) { super(); this.id = label; contents.set(label, this); this.ready = ready; for (const accept of windowWaiters.get(label) ?? []) accept(this); }
  send(channel: string, ...args: any[]) { writeProtocol({ type: 'event', window: this.label, channel, args }); }
  isDestroyed() { return this.closed; }
  isLoading() { return this.loading; }
  getURL() { return this.url; }
  canGoBack() { return this.back; }
  canGoForward() { return this.forward; }
  async loadURL(url: string) {
    this.url = url; this.loading = true; this.emit('did-start-loading');
    await this.ready;
    await nativeCall('webview-navigate', { label: this.label, url });
  }
  setWindowOpenHandler(_callback: (event: { url: string }) => { action: string }) {
    // Native WebView navigation is enforced centrally in Rust. HTTPS popups are
    // reported as browser-popup events and become isolated native child views.
    this.on('popup', (url: string) => _callback({ url }));
  }
  async executeJavaScript(script: string) { await this.ready; return nativeCall('webview-eval', { label: this.label, script }); }
  goBack() { return nativeCall('webview-action', { label: this.label, action: 'back' }); }
  goForward() { return nativeCall('webview-action', { label: this.label, action: 'forward' }); }
  reload() { void nativeCall('webview-action', { label: this.label, action: 'reload' }); }
  stop() { void nativeCall('webview-action', { label: this.label, action: 'stop' }); this.loading = false; }
  findInPage(text: string) { void this.executeJavaScript(`window.find(${JSON.stringify(text)})`); }
  close() {
    if (this.closed) return;
    this.closed = true; contents.delete(this.label);
    void nativeCall('webview-close', { label: this.label }); this.emit('destroyed');
  }
  update(value: any) {
    if (typeof value.url === 'string') this.url = value.url;
    if (typeof value.back === 'boolean') this.back = value.back;
    if (typeof value.forward === 'boolean') this.forward = value.forward;
    if (value.phase === 'finished') { this.loading = false; this.emit('did-stop-loading'); this.emit('did-navigate'); }
    if (value.phase === 'started') { this.loading = true; this.emit('did-start-loading'); }
    if (typeof value.title === 'string') this.emit('page-title-updated', event(), value.title);
  }
}
export class NativeWindow extends EventEmitter {
  readonly webContents: NativeContents;
  private dead = false;
  private maximized = false;
  private minimized = false;
  private width: number;
  private height: number;
  readonly contentView: { children: NativeBrowserView[]; addChildView(view: NativeBrowserView): void; removeChildView(view: NativeBrowserView): void };
  constructor(readonly options: { label: string; width: number; height: number; minWidth?: number; minHeight?: number; title?: string; show?: boolean; [key: string]: unknown }) {
    super(); this.width = options.width; this.height = options.height;
    if(options.label !== 'main')throw Error('Orion uses one native window; browser tabs belong to Canvas.');
    const ready = Promise.resolve();
    this.webContents = new NativeContents(options.label, ready); windows.set(options.label, this);
    const children: NativeBrowserView[] = [];
    this.contentView = { children, addChildView(view) { if (!children.includes(view)) children.push(view); }, removeChildView(view) { const index = children.indexOf(view); if (index >= 0) children.splice(index, 1); } };
  }
  static getAllWindows() { return [...windows.values()]; }
  static fromWebContents(value: NativeContents) { return windows.get(value.label); }
  isDestroyed() { return this.dead; }
  isMaximized() { return this.maximized; }
  isMinimized() { return this.minimized; }
  getContentBounds() { return { width: this.width, height: this.height }; }
  minimize() { this.minimized = true; void nativeCall('window-action', { label: this.options.label, action: 'minimize' }); }
  maximize() { this.maximized = true; void nativeCall('window-action', { label: this.options.label, action: 'maximize' }); }
  unmaximize() { this.maximized = false; void nativeCall('window-action', { label: this.options.label, action: 'unmaximize' }); }
  restore() { this.minimized = false; void nativeCall('window-action', { label: this.options.label, action: 'restore' }); }
  show() { void nativeCall('window-action', { label: this.options.label, action: 'show' }); }
  hide() { this.emit('hide'); void nativeCall('window-action', { label: this.options.label, action: 'hide' }); }
  focus() { void nativeCall('window-action', { label: this.options.label, action: 'focus' }); }
  close() {
    const requested = event(); this.emit('close', requested);
    if (!requested.defaultPrevented) this.destroy();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true; windows.delete(this.options.label); contents.delete(this.options.label);
    void nativeCall('window-action', { label: this.options.label, action: 'destroy' }); this.emit('closed');
  }
  async loadFile(file: string) {
    await this.webContents.ready;
    await nativeCall('window-load', { label: this.options.label, file: path.basename(file) });
  }
  async loadURL(url: string) { return this.webContents.loadURL(url); }
  update(value: any) { this.width = value.width ?? this.width; this.height = value.height ?? this.height; this.maximized = value.maximized ?? this.maximized; this.emit('resize'); }
}
let viewSerial = 0;
export class NativeBrowserView {
  readonly webContents: NativeContents;
  constructor(_options?: unknown) {
    const label = `browser-tab-${++viewSerial}`;
    this.webContents = new NativeContents(label, (windows.get('main')?.webContents.ready ?? Promise.resolve()).then(() => nativeCall('webview-create', { label, parent: 'main' })));
  }
  setBackgroundColor(color: string) { void this.webContents.ready.then(() => nativeCall('webview-background', { label: this.webContents.label, color })); }
  setVisible(visible: boolean) { void this.webContents.ready.then(() => nativeCall('webview-visible', { label: this.webContents.label, visible })); }
  setBounds(bounds: { x: number; y: number; width: number; height: number }) { void this.webContents.ready.then(() => nativeCall('webview-bounds', { label: this.webContents.label, ...bounds })); }
}
class HostApplication extends EventEmitter {
  readonly isPackaged = process.env.ORION_PACKAGED === '1';
  getVersion() { return process.env.ORION_VERSION ?? '0.2.0'; }
  getAppPath() { return process.env.ORION_RESOURCE_ROOT ?? path.resolve(import.meta.dir, '../..'); }
  getPath(name: string) {
    const paths: Record<string, string> = JSON.parse(process.env.ORION_PATHS ?? '{}');
    const value = paths[name];
    if (!value) throw Error(`Native application directory is unavailable: ${name}`);
    return value;
  }
  whenReady() { return Promise.resolve(); }
  requestSingleInstanceLock() { return true; } // The native Tauri singleton owns this lock.
  quit() { const request = event(); this.emit('before-quit', request); if (!request.defaultPrevented) void nativeCall('quit'); }
  relaunch(options: { execPath: string; args: string[] }) { void nativeCall('relaunch', options); }
}
export const app = new HostApplication();
export const dialog = {
  showOpenDialog: (_owner: NativeWindow, options: Record<string, any>): Promise<{ canceled: boolean; filePaths: string[] }> => nativeCall('dialog-open', options),
  showMessageBox: (_owner: NativeWindow, options: Record<string, any>): Promise<{ response: number }> => nativeCall('dialog-message', options),
  showErrorBox(title: string, message: string) { void nativeCall('dialog-message', { title, message, type: 'error', buttons: ['Close'] }); },
};
export const shell = {
  openExternal: (url: string): Promise<void> => nativeCall('open-external', { url }),
  openPath: (file: string): Promise<string> => nativeCall('open-path', { file }),
  showItemInFolder: (file: string) => { void nativeCall('reveal-file', { file }); },
};
export class NativeTray {
  readonly ready = nativeCall('tray-enable');
  setSwarmState(state: { running: boolean; name: string; iteration: number; idleMinutes: number; cycleMinutes: number }) { return nativeCall('tray-swarm-state', state); }
  destroy() { void nativeCall('tray-disable'); }
}
setEventReceiver(value => {
  if (value.event === 'window-close') windows.get(value.window)?.close();
  else if (value.event === 'window-size') windows.get(value.window)?.update(value);
  else if (value.event === 'browser-event') contents.get(value.label)?.update(value);
  else if (value.event === 'browser-popup') contents.get(value.label)?.emit('popup', value.url);
  else if (value.event === 'browser-shortcut') windows.get('main')?.webContents.send('browser:shortcut', value.action);
  else if (value.event === 'tray-show' || value.event === 'second-instance') app.emit('activate');
  else if (value.event === 'tray-swarm-pause') app.emit('tray-swarm-pause');
  else if (value.event === 'tray-quit' || value.event === 'shutdown' || value.event === 'parent-exited') app.quit();
});
