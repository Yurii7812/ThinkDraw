// 画面(renderer)に渡す、限られた API
import { contextBridge, ipcRenderer, webUtils } from "electron";

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
  saveAttachment: (name: string, data: Uint8Array): Promise<string> => ipcRenderer.invoke("vault:saveAttachment", name, data),
  bookletRead: (kind: string): Promise<Uint8Array> => ipcRenderer.invoke("booklet:read", kind),
  bookletVolumes: (): Promise<Record<"full" | "upright", { pages: number; vols: { n: number; from: number; to: number; pages: number; sheets: number }[] }>> => ipcRenderer.invoke("booklet:volumes"),
  deckImage: (deck: string, file: string): Promise<Uint8Array | null> => ipcRenderer.invoke("deck:image", deck, file),
  readAsset: (rel: string): Promise<Uint8Array | null> => ipcRenderer.invoke("asset:read", rel),
  openAsset: (rel: string): Promise<string> => ipcRenderer.invoke("asset:open", rel),
  urlTitle: (url: string): Promise<string | null> => ipcRenderer.invoke("url:title", url),
  exportSave: (name: string, label: string, exts: string[], data: string | Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke("export:save", name, label, exts, data),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open", url),
  /** 窓の中の、その四角(CSS の px)を写した PNG(書き出しを画面と同じ見た目にする。2026-11-27) */
  shareStart: (title: string, initial?: unknown) => ipcRenderer.invoke("share:start", title, initial),
  shareStop: () => ipcRenderer.invoke("share:stop"),
  shareInfo: () => ipcRenderer.invoke("share:info"),
  capture: (r: { x: number; y: number; width: number; height: number }): Promise<Uint8Array> => ipcRenderer.invoke("win:capture", r),
  // 紙PKM
  paperIndex: () => ipcRenderer.invoke("paper:index"),
  paperStage: (files: string[]) => ipcRenderer.invoke("paper:stage", files),
  paperCommit: (batch: string, decisions: { key: string; fz: string | null; include: boolean }[]) => ipcRenderer.invoke("paper:commit", batch, decisions),
  paperDiscard: (batch: string) => ipcRenderer.invoke("paper:discard", batch),
  paperSetFz: (pid: string, fz: string | null) => ipcRenderer.invoke("paper:setFz", pid, fz),
  paperRemove: (pid: string) => ipcRenderer.invoke("paper:remove", pid),
  paperOcrSettings: () => ipcRenderer.invoke("paper:ocrSettings"),
  paperSetOcrSettings: (s: Record<string, unknown>) => ipcRenderer.invoke("paper:setOcrSettings", s),
  paperPickFiles: (): Promise<string[]> => ipcRenderer.invoke("paper:pickFiles"),
  paperExport: (): Promise<{ dir: string; n: number } | null> => ipcRenderer.invoke("paper:export"),
  onPaperProgress: (fn: (p: { batch: string; phase: string; done: number; total: number; message?: string }) => void) =>
    ipcRenderer.on("paper:progress", (_e, p) => fn(p)),
  /** 落としたファイルの、ディスク上の場所 */
  pathOf: (f: File): string => webUtils.getPathForFile(f),
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

contextBridge.exposeInMainWorld("bresuto", api);
export type BresutoApi = typeof api;
