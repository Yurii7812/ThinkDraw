// 画面(renderer)に渡す、限られた API
import { contextBridge, ipcRenderer } from "electron";

const api = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke("config:set", patch),
  initialVault: (): Promise<string | null> => ipcRenderer.invoke("vault:initial"),
  chooseVault: (): Promise<string | null> => ipcRenderer.invoke("vault:choose"),
  readAll: (): Promise<{ name: string; content: string }[]> => ipcRenderer.invoke("vault:readAll"),
  watch: () => ipcRenderer.invoke("vault:watch"),
  write: (name: string, content: string) => ipcRenderer.invoke("vault:write", name, content),
  trash: (name: string, content: string) => ipcRenderer.invoke("vault:trash", name, content),
  readApp: (name: string): Promise<string | null> => ipcRenderer.invoke("vault:readApp", name),
  writeApp: (name: string, content: string) => ipcRenderer.invoke("vault:writeApp", name, content),
  saveAsset: (ext: string, data: Uint8Array): Promise<string> => ipcRenderer.invoke("vault:saveAsset", ext, data),
  urlTitle: (url: string): Promise<string | null> => ipcRenderer.invoke("url:title", url),
  exportSave: (name: string, label: string, exts: string[], data: string | Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke("export:save", name, label, exts, data),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),
  onChanged: (fn: (e: { name: string; content: string | null }) => void) =>
    ipcRenderer.on("vault:changed", (_e, arg) => fn(arg)),
  onFlush: (fn: () => Promise<void>) =>
    ipcRenderer.on("app:flush", async () => {
      try {
        await fn();
      } finally {
        ipcRenderer.send("app:flushed");
      }
    }),
};

contextBridge.exposeInMainWorld("thinkdraw", api);
export type ThinkDrawApi = typeof api;
