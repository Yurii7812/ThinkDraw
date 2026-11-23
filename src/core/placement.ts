// Tab・Enter で次の文字を置く場所(2026-11-22 利用者の希望):
// 親のまわり全方向に、すでに置いてあるものとなるべく離れる所を選ぶ。遠すぎない輪から順に探し、
// その輪の中で一番空いている方向を選ぶ。ただし毎回まったく同じにならないよう、少しだけ乱す。

export interface Rect {
  x: number; // 左上
  y: number;
  w: number;
  h: number;
}

/** 2 つの長方形の隙間(重なっていれば 0) */
export function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

/** 線分 (x1,y1)-(x2,y2) が長方形(まわりに pad の余白)を通るか */
export function segHitsRect(x1: number, y1: number, x2: number, y2: number, r: Rect, pad = 4): boolean {
  const L = r.x - pad, R = r.x + r.w + pad, T = r.y - pad, B = r.y + r.h + pad;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x1 - L) && clip(dx, R - x1) && clip(-dy, y1 - T) && clip(dy, B - y1);
}

export interface PlaceOptions {
  /** これらの物を、つなぐ線が通らないようにする(文字の箱。ペンの線や線の印は入れない) */
  lineBlockers?: Rect[];
  /** 新しいものの大きさ(推定) */
  size?: { w: number; h: number };
  /** これ以上空いていれば、その輪で決める */
  enough?: number;
  rand?: () => number; // [0, 1)
}

export function placeAround(anchor: Rect, obstacles: Rect[], o: PlaceOptions = {}): { x: number; y: number } {
  const size = o.size ?? { w: 90, h: 26 };
  const enough = o.enough ?? 36;
  const rand = o.rand ?? Math.random;
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const all = [anchor, ...obstacles];
  const N = 24;
  const base = Math.max(anchor.w, anchor.h) / 2 + Math.max(size.w, size.h) / 2 + 50;
  let best: { x: number; y: number; c: number } | null = null;
  for (let ring = 0; ring < 8; ring++) {
    const r = base + ring * 55;
    const rot = rand() * ((Math.PI * 2) / N);
    const cands: { x: number; y: number; c: number }[] = [];
    for (let i = 0; i < N; i++) {
      const a = rot + (i * Math.PI * 2) / N;
      // 横に長い文字が多いので、輪は少し横長に
      const px = cx + Math.cos(a) * r * 1.35 - size.w / 2;
      const py = cy + Math.sin(a) * r * 0.85 - size.h / 2;
      const me = { x: px, y: py, w: size.w, h: size.h };
      let c = Math.min(...all.map((b) => gap(me, b)));
      // 親からの線が、ほかの文字の上を通る所は選ばない
      if (o.lineBlockers?.some((b) => segHitsRect(cx, cy, px + size.w / 2, py + size.h / 2, b))) c = Math.min(c, 1);
      cands.push({ x: Math.round(px), y: Math.round(py), c });
    }
    cands.sort((p, q) => q.c - p.c);
    if (!best || cands[0].c > best.c) best = cands[0];
    if (cands[0].c >= enough) {
      // 一番空いている方向の近く(空き具合が 8 割以上のもの)から、ランダムに 1 つ
      const good = cands.filter((p) => p.c >= cands[0].c * 0.8 && p.c >= enough);
      return good[Math.floor(rand() * good.length)];
    }
  }
  return { x: best!.x, y: best!.y };
}

/**
 * まとめて置くもの(スプレッドなど)が、すでにあるものと重ならないよう、一番近い空いている所へずらす量。
 * 40px 刻みで、近い順に試す。
 */
export function freeOffset(boxes: Rect[], obstacles: Rect[], margin = 30): { dx: number; dy: number } {
  if (!boxes.length || !obstacles.length) return { dx: 0, dy: 0 };
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const offs: [number, number][] = [];
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) offs.push([i * 40, j * 40]);
  offs.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const [dx, dy] of offs) {
    const me = { x: x0 + dx - margin, y: y0 + dy - margin, w: x1 - x0 + margin * 2, h: y1 - y0 + margin * 2 };
    if (!obstacles.some((o) => gap(me, o) === 0)) return { dx, dy };
  }
  return { dx: 0, dy: 0 };
}
