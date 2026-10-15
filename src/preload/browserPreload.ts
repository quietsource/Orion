import { contextBridge, ipcRenderer } from 'electron';

const api = {
  state: () => ipcRenderer.invoke('browser:state'),
  create: (url?: string) => ipcRenderer.invoke('browser:create', url),
  focus: (id: string) => ipcRenderer.invoke('browser:focus', id),
  close: (id: string) => ipcRenderer.invoke('browser:close', id),
  navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  action: (action: string) => ipcRenderer.invoke('browser:action', action),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  }
};

contextBridge.exposeInMainWorld('orionBrowser', api);
