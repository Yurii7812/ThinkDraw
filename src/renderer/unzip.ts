// zip の中の 1 つのファイルを読む(XMind の取り込み用。2026-11-27)。保存(0)と deflate(8)だけ
export async function readZipEntry(data: Uint8Array, want: (name: string) => boolean): Promise<string | null> {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // 終わりの印(End of central directory)を後ろから探す
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= data.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = data.subarray(start, start + csize);
    if (method === 0) return dec.decode(raw);
    if (method !== 8) return null;
    const ds = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return dec.decode(new Uint8Array(await new Response(ds).arrayBuffer()));
  }
  return null;
}
