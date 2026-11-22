// vault のフォルダの読み書き(Node.js)。main プロセスと試験で使う。

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { FileEntry, VaultIO } from "../core/vault";

export const APP_DIR = ".thinkdraw";
export const TRASH_DIR = ".trash";
export const ASSETS_DIR = "assets";

/** 一時ファイルに書いてからリネームする(保存中の強制終了でファイルが壊れないように) */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
  const h = await fs.open(tmp, "w");
  try {
    await h.writeFile(data);
    await h.sync();
  } finally {
    await h.close();
  }
  await fs.rename(tmp, file);
}

function safeName(name: string): string {
  if (name !== path.basename(name) || name.startsWith(".")) throw new Error(`使えないファイル名: ${name}`);
  return name;
}

export class FsVaultIO implements VaultIO {
  constructor(readonly dir: string) {}

  async write(name: string, content: string): Promise<void> {
    await atomicWrite(path.join(this.dir, safeName(name)), content);
    await fs.rm(path.join(this.dir, TRASH_DIR, name), { force: true });
  }

  async trash(name: string, content: string): Promise<void> {
    const dest = path.join(this.dir, TRASH_DIR, safeName(name));
    const src = path.join(this.dir, name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(src, dest);
    } catch {
      // 元のファイルが無い(外から消された)ときは、覚えている中身を置く
      if (content) await atomicWrite(dest, content);
    }
  }

  async readAll(): Promise<FileEntry[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith(".md") && !n.startsWith("."));
    const out: FileEntry[] = [];
    for (const name of names.sort()) {
      try {
        out.push({ name, content: await fs.readFile(path.join(this.dir, name), "utf8") });
      } catch {
        /* 読めないものは飛ばす */
      }
    }
    return out;
  }

  async readOne(name: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.dir, safeName(name)), "utf8");
    } catch {
      return null;
    }
  }

  async readAppFile(name: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.dir, APP_DIR, safeName(name)), "utf8");
    } catch {
      return null;
    }
  }

  async writeAppFile(name: string, content: string): Promise<void> {
    await atomicWrite(path.join(this.dir, APP_DIR, safeName(name)), content);
  }

  /** 貼り付けた画像を assets/ に保存し、本文に書く相対パスを返す */
  async saveAsset(ext: string, data: Uint8Array): Promise<string> {
    const clean = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "png";
    for (;;) {
      const name = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex")}.${clean}`;
      const file = path.join(this.dir, ASSETS_DIR, name);
      try {
        await fs.access(file);
      } catch {
        await atomicWrite(file, data);
        return `${ASSETS_DIR}/${name}`;
      }
    }
  }
}
