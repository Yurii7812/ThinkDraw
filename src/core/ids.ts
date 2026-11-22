// ノードの ID: ランダムな 10 文字(小文字英数字)。暗号論的な乱数を使う。

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ID_RE = /^[a-z0-9]{10}$/;

export function randomInt(maxExclusive: number): number {
  // 偏りをなくすため、棄却法で取る
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

export function randomId(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** 衝突したら作り直す */
export function newId(exists: (id: string) => boolean): string {
  for (;;) {
    const id = randomId();
    if (!exists(id)) return id;
  }
}

/** 現地時刻のオフセット付き ISO 文字列(例 2026-11-22T18:05:00+09:00) */
export function nowIso(d: Date = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
  );
}
