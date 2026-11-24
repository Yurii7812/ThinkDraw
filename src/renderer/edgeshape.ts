// 線の形(2026-11-24 統合仕様 3〜5): 終わりの印(矢印・部分の括弧)と、交差を乗り越える小さな弧。
// キャンバス・メニューの見本・全体の画面・書き出しで同じ形を使う。
import type { LinkKind } from "../core/types";

export interface Pt {
  x: number;
  y: number;
}

const ARROW_L = 13; // 矢印の長さ
const ARROW_W = 5.5; // 矢印の半分の幅
const BR_H = 14; // 括弧の高さ
const BR_D = 5; // 括弧の奥行き

/**
 * a → b の線の、本体の始まりと終わり・終わりの印。
 * fill = 塗る印(矢印)、stroke = 線で描く印(括弧)。部分・全体の括弧は b の側(部分)に、開いた側を b へ向ける
 */
export function edgeEnds(kind: LinkKind, a: Pt, b: Pt, s = 1): { start: Pt; end: Pt; fill: string; stroke: string } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const nx = -uy, ny = ux;
  let start = a, end = b, fill = "", stroke = "";
  const arrow = (tip: Pt, dx: number, dy: number) => {
    const L = ARROW_L * s, W = ARROW_W * s;
    const bx = tip.x - dx * L, by = tip.y - dy * L;
    const mx = tip.x - dx * L * 0.72, my = tip.y - dy * L * 0.72;
    return `M${r(tip.x)},${r(tip.y)} L${r(bx + -dy * W)},${r(by + dx * W)} L${r(mx)},${r(my)} L${r(bx - -dy * W)},${r(by - dx * W)} Z`;
  };
  if (kind === "arrow" || kind === "double") {
    fill += arrow(b, ux, uy);
    end = { x: b.x - ux * ARROW_L * s * 0.72, y: b.y - uy * ARROW_L * s * 0.72 };
  }
  if (kind === "double") {
    fill += arrow(a, -ux, -uy);
    start = { x: a.x + ux * ARROW_L * s * 0.72, y: a.y + uy * ARROW_L * s * 0.72 };
  }
  if (kind === "part") {
    // 括弧の背の真ん中に線をつなぐ。開いた側は部分(b)の方
    const H = (BR_H * s) / 2, D = BR_D * s;
    const bk = { x: b.x - ux * D, y: b.y - uy * D };
    const p = (k: number, d: number) => `${r(bk.x + nx * k + ux * d)},${r(bk.y + ny * k + uy * d)}`;
    stroke = `M${p(H, D)} L${p(H, 0)} L${p(-H, 0)} L${p(-H, D)}`;
    end = bk;
  }
  return { start, end, fill, stroke };
}

function r(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 交差を乗り越える線: a から b へ、hops(a からの距離)の所で半径 rad の小さな弧(上へ。縦の線なら左へ) */
export function hopPath(a: Pt, b: Pt, hops: number[], rad = 6): string {
  if (!hops.length) return `M${r(a.x)},${r(a.y)} L${r(b.x)},${r(b.y)}`;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  // 弧のふくらむ側: sweep=1 なら (uy, -ux) の側。上(y が小さい側)、縦なら左へ
  const n1x = uy, n1y = -ux;
  const sweep = Math.abs(n1y) > 1e-3 ? (n1y < 0 ? 1 : 0) : n1x < 0 ? 1 : 0;
  let d = `M${r(a.x)},${r(a.y)}`;
  for (const t of hops) {
    const p = { x: a.x + ux * (t - rad), y: a.y + uy * (t - rad) };
    const q = { x: a.x + ux * (t + rad), y: a.y + uy * (t + rad) };
    d += ` L${r(p.x)},${r(p.y)} A${rad},${rad} 0 0 ${sweep} ${r(q.x)},${r(q.y)}`;
  }
  return d + ` L${r(b.x)},${r(b.y)}`;
}

export interface Seg {
  key: string;
  a: Pt;
  b: Pt;
  ends: [string, string]; // つないでいるノード
}

/**
 * 交差して乗り越える所(線ごとの、a からの距離)。
 * 同じノードにつながる線どうし・ほぼ平行な線・端の近くは乗り越えない。どちらが乗り越えるかは、より横向きの線(同じなら key の大きい方)
 */
export function findHops(segs: Seg[], rad = 6): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const info = segs.map((s) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { s, dx, dy, len, flat: Math.abs(dx) / len };
  });
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const A = info[i], B = info[j];
      if (A.s.ends.some((e) => B.s.ends.includes(e))) continue;
      const den = A.dx * B.dy - A.dy * B.dx;
      if (Math.abs(den) / (A.len * B.len) < 0.26) continue; // ほぼ平行(15° 未満)
      const ex = B.s.a.x - A.s.a.x, ey = B.s.a.y - A.s.a.y;
      const t = (ex * B.dy - ey * B.dx) / den;
      const u = (ex * A.dy - ey * A.dx) / den;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      const da = t * A.len, db = u * B.len;
      const margin = rad + 3;
      if (da < margin || A.len - da < margin || db < margin || B.len - db < margin) continue;
      const aHops = A.flat > B.flat + 1e-6 || (Math.abs(A.flat - B.flat) <= 1e-6 && A.s.key > B.s.key);
      const [who, dist] = aHops ? [A.s.key, da] : [B.s.key, db];
      (out.get(who) ?? out.set(who, []).get(who)!).push(dist);
    }
  }
  // 近すぎる弧はまとめる
  for (const [k, list] of out) {
    list.sort((p, q) => p - q);
    const kept: number[] = [];
    for (const t of list) if (!kept.length || t - kept[kept.length - 1] > rad * 2 + 4) kept.push(t);
    out.set(k, kept);
  }
  return out;
}

/** メニューの見本の SVG(幅 64・高さ 14)。実際の線と同じ形 */
export function kindPreview(kind: LinkKind): string {
  const a = { x: 3, y: 7 }, b = { x: 61, y: 7 };
  const e = edgeEnds(kind, a, b, 0.85);
  const dash = kind === "dashed" ? ' stroke-dasharray="5 4"' : "";
  const w = kind === "thick" ? 3.5 : 1.6;
  return (
    `<path d="M${e.start.x},${e.start.y} L${e.end.x},${e.end.y}" fill="none" stroke="currentColor" stroke-width="${w}"${dash}/>` +
    (e.fill ? `<path d="${e.fill}" fill="currentColor"/>` : "") +
    (e.stroke ? `<path d="${e.stroke}" fill="none" stroke="currentColor" stroke-width="1.8"/>` : "")
  );
}

/**
 * 部分・全体の括弧が、部分のノードに隠れないように線の終わりを手前へずらす(2026-11-24 修正8・利用者の見本)。
 * 括弧の四隅がノードの箱(+ gap)の外に出るまで、線に沿って from の方へ下げる。ノードは動かさない
 */
export function partEnd(box: { x: number; y: number; w: number; h: number }, from: Pt, to: Pt, gap = 6): Pt {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len, uy = (to.y - from.y) / len;
  const nx = -uy, ny = ux;
  const H = BR_H / 2, D = BR_D;
  const L = box.x - gap, R = box.x + box.w + gap, T = box.y - gap, B = box.y + box.h + gap;
  const inside = (x: number, y: number) => x > L && x < R && y > T && y < B;
  let b = { x: to.x - ux * 4, y: to.y - uy * 4 }; // 見本のように少し手前から
  for (let k = 0; k < 60; k++) {
    const bk = { x: b.x - ux * D, y: b.y - uy * D };
    const pts = [
      [b.x + nx * H, b.y + ny * H],
      [b.x - nx * H, b.y - ny * H],
      [bk.x + nx * H, bk.y + ny * H],
      [bk.x - nx * H, bk.y - ny * H],
    ];
    if (!pts.some(([x, y]) => inside(x, y))) break;
    b = { x: b.x - ux, y: b.y - uy };
  }
  // 近すぎて線より手前に戻ってしまうときは、線の真ん中まで
  const back = (b.x - from.x) * ux + (b.y - from.y) * uy;
  if (back < len / 2) b = { x: from.x + ux * Math.max(len / 2, BR_D * 2), y: from.y + uy * Math.max(len / 2, BR_D * 2) };
  return b;
}

/**
 * 文字(ノード)をよける道(2026-11-24 利用者「文字の枠に沿う感じ」): 線がノードの箱(+ pad)を通るなら、
 * 箱に入る所から出る所まで、箱の縁に沿って短い方を回る。よける物が無ければ null(まっすぐ)
 */
export function routeAround(a: Pt, b: Pt, boxes: { x: number; y: number; w: number; h: number; pad?: number; avoid?: Pt[] }[], pad0 = 14): { pts: Pt[]; used: number[] } | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const hits: { t0: number; t1: number; L: number; T: number; R: number; B: number; bi: number; avoid: Pt[] }[] = [];
  for (const [bi, bx] of boxes.entries()) {
    const pad = bx.pad ?? pad0;
    const L = bx.x - pad, T = bx.y - pad, R = bx.x + bx.w + pad, B = bx.y + bx.h + pad;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a.x - L], [dx, R - a.x], [-dy, a.y - T], [dy, B - a.y]] as [number, number][]) {
      if (p === 0) {
        if (q < 0) ok = false;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (!ok || t0 >= t1 || t0 <= 0.001 || t1 >= 0.999) continue; // 端がこの箱の中・かすりもしない
    hits.push({ t0, t1, L, T, R, B, bi, avoid: bx.avoid ?? [] });
  }
  if (!hits.length) return null;
  hits.sort((p, q) => p.t0 - q.t0);
  const pts: Pt[] = [a];
  const used: number[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.t0 < last) continue; // 重なった箱は、先のものだけ
    const E = { x: a.x + dx * h.t0, y: a.y + dy * h.t0 }, X = { x: a.x + dx * h.t1, y: a.y + dy * h.t1 };
    const w = h.R - h.L, hh = h.B - h.T, P = 2 * (w + hh);
    const s = (p: Pt) => {
      const d = [Math.abs(p.y - h.T), Math.abs(p.x - h.R), Math.abs(p.y - h.B), Math.abs(p.x - h.L)];
      const side = d.indexOf(Math.min(...d));
      return side === 0 ? p.x - h.L : side === 1 ? w + (p.y - h.T) : side === 2 ? w + hh + (h.R - p.x) : 2 * w + hh + (h.B - p.y);
    };
    const corners: [number, Pt][] = [[0, { x: h.L, y: h.T }], [w, { x: h.R, y: h.T }], [w + hh, { x: h.R, y: h.B }], [2 * w + hh, { x: h.L, y: h.B }]];
    const se = s(E), sx = s(X);
    const cw = (sx - se + P) % P;
    // その箱につながっているほかの線の端をまたがない側を選ぶ(またぐと、つながって見える。2026-11-24 利用者)。同じなら短い方
    const onCw = (q: Pt) => {
      // 箱の縁へ寄せてから、縁の上の位置で比べる
      const c = { x: Math.min(h.R, Math.max(h.L, q.x)), y: Math.min(h.B, Math.max(h.T, q.y)) };
      return (s(c) - se + P) % P < cw;
    };
    const nCw = h.avoid.filter(onCw).length, nCcw = h.avoid.length - nCw;
    const goCw = nCw !== nCcw ? nCw < nCcw : cw <= P - cw;
    const pass: Pt[] = [];
    if (goCw) {
      for (const [cs, c] of [...corners, ...corners.map(([k, c]) => [k + P, c] as [number, Pt])]) if (cs > se && cs < se + cw) pass.push(c);
    } else {
      for (const [cs, c] of [...corners, ...corners.map(([k, c]) => [k + P, c] as [number, Pt])].reverse()) if (cs < se + P && cs > se + P - (P - cw)) pass.push(c);
    }
    pts.push(E, ...pass, X);
    used.push(h.bi);
    last = h.t1;
  }
  pts.push(b);
  return { pts, used };
}

/** 折れ線を、角を半径 r で丸めた道に */
export function roundedPath(pts: Pt[], r = 7): string {
  let d = `M${rr(pts[0].x)},${rr(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y), l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 0.5) {
      d += ` L${rr(c.x)},${rr(c.y)}`;
      continue;
    }
    const pin = { x: c.x - ((c.x - p.x) / l1) * k, y: c.y - ((c.y - p.y) / l1) * k };
    const pout = { x: c.x + ((n.x - c.x) / l2) * k, y: c.y + ((n.y - c.y) / l2) * k };
    d += ` L${rr(pin.x)},${rr(pin.y)} Q${rr(c.x)},${rr(c.y)} ${rr(pout.x)},${rr(pout.y)}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${rr(z.x)},${rr(z.y)}`;
}
function rr(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 折れ線の上の、長さの割合 f の所 */
export function pointAlong(pts: Pt[], f: number): Pt {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  let want = seg.reduce((x, y) => x + y, 0) * f;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, want / seg[i]) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}

/**
 * 折れ線(よけた線)を、角を丸め、交差の所は小さな弧で乗り越える道に。hops[i] = i 番目の区間の始まりからの距離
 */
export function polyPath(pts: Pt[], hops: number[][] = [], r = 7, rad = 6): string {
  const n = pts.length;
  const k: number[] = pts.map(() => 0);
  for (let i = 1; i < n - 1; i++) {
    const l1 = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y), l2 = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    k[i] = Math.min(r, l1 / 2, l2 / 2);
  }
  let d = `M${rr(pts[0].x)},${rr(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const n1x = uy, n1y = -ux;
    const sweep = Math.abs(n1y) > 1e-3 ? (n1y < 0 ? 1 : 0) : n1x < 0 ? 1 : 0;
    for (const t of (hops[i] ?? []).slice().sort((p, q) => p - q)) {
      if (t - rad < k[i] || t + rad > len - k[i + 1]) continue;
      d += ` L${rr(a.x + ux * (t - rad))},${rr(a.y + uy * (t - rad))} A${rad},${rad} 0 0 ${sweep} ${rr(a.x + ux * (t + rad))},${rr(a.y + uy * (t + rad))}`;
    }
    if (i < n - 2 && k[i + 1] >= 0.5) {
      const c = pts[i + 1], nx = pts[i + 2];
      const l2 = Math.hypot(nx.x - c.x, nx.y - c.y) || 1;
      d += ` L${rr(c.x - ux * k[i + 1])},${rr(c.y - uy * k[i + 1])} Q${rr(c.x)},${rr(c.y)} ${rr(c.x + ((nx.x - c.x) / l2) * k[i + 1])},${rr(c.y + ((nx.y - c.y) / l2) * k[i + 1])}`;
    } else d += ` L${rr(b.x)},${rr(b.y)}`;
  }
  return d;
}
