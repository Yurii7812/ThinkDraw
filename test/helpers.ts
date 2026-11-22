// 試験は一時ディレクトリの中の vault でだけ行う(利用者の本物のフォルダには書かない)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { FsVaultIO } from "../src/main/fsio";
import { Vault } from "../src/core/vault";

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "thinkdraw-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let tick = 0;
export const fakeNow = () => `2026-11-22T18:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}:${String(tick++ % 60).padStart(2, "0")}+09:00`;

export async function openVault(dir: string): Promise<{ v: Vault; io: FsVaultIO }> {
  const io = new FsVaultIO(dir);
  const v = new Vault(io, fakeNow);
  v.load(await io.readAll());
  return { v, io };
}
