// 配置の補助(2026-11-27 利用者。zip「配置補助・接続線改善 統合版」・質問票 br-1127c)。
// 方針: 文章・ID・つながり・所属は変えない。動かすのは位置だけで、重なっている物だけ・必要なだけ。線どうしの交差はそのまま。
import { gap, segHitsRect, type Rect } from "./placement";

export interface ArrItem {
  id: string;
  r: Rect;
}
export interface ArrLink {
  from: string;
  to: string;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * 重なりをどかす。文字どうしが重なる・線が(両端以外の)文字の上を通るとき、その文字だけを近い所へ少し動かす。
 * movable = 動かしてよい物。targets = 直す対象(無ければ movable 全部)。onlyLinks = この線と重なる物だけを見る("from>to")。
 * 返すのは、動かした物の新しい左上と、どうしても直せなかった物
 */
export function resolveOverlaps(
  items: ArrItem[],
  links: ArrLink[],
  movable: (id: string) => boolean,
  opts: { onlyLinks?: Set<string>; maxDist?: number } = {},
): { moves: Map<string, { x: number; y: number }>; unresolved: string[] } {
  const pos = new Map(items.map((i) => [i.id, { ...i.r }]));
  const deg = new Map<string, number>();
  for (const l of links) for (const e of [l.from, l.to]) deg.set(e, (deg.get(e) ?? 0) + 1);
  const live = links.filter((l) => pos.has(l.from) && pos.has(l.to) && l.from !== l.to);
  const segOf = (l: ArrLink) => [center(pos.get(l.from)!), center(pos.get(l.to)!)] as const;
  const MARGIN = 3;
  /** この物が今いる所で困っているか(focus = 対象の線だけを見る) */
  const troubled = (id: string, r: Rect, focus: boolean): boolean => {
    if (!focus || !opts.onlyLinks) {
      for (const [o, q] of pos) if (o !== id && gap(r, q) < MARGIN && overlapArea(r, q) > 0) return true;
    }
    for (const l of live) {
      if (l.from === id || l.to === id) continue;
      if (focus && opts.onlyLinks && !opts.onlyLinks.has(l.from + ">" + l.to)) continue;
      const [a, b] = segOf(l);
      if (segHitsRect(a.x, a.y, b.x, b.y, r, 1)) return true;
    }
    return false;
  };
  /** 動かした先で、新しく困らないか: ほかの文字と重ならない・線が上を通らない・自分の線がほかの文字の上を通らない */
  const okAt = (id: string, r: Rect): boolean => {
    for (const [o, q] of pos) if (o !== id && gap(r, q) < MARGIN + 3) return false;
    for (const l of live) {
      if (l.from === id || l.to === id) continue;
      const [a, b] = segOf(l);
      if (segHitsRect(a.x, a.y, b.x, b.y, r, 3)) return false;
    }
    const c = center(r);
    for (const l of live) {
      if (l.from !== id && l.to !== id) continue;
      const other = pos.get(l.from === id ? l.to : l.from)!;
      const oc = center(other);
      for (const [o, q] of pos) {
        if (o === id || o === l.from || o === l.to) continue;
        if (segHitsRect(c.x, c.y, oc.x, oc.y, q, 1)) return false;
      }
    }
    return true;
  };
  const moved = new Map<string, { x: number; y: number }>();
  const unresolved = new Set<string>();
  const maxDist = opts.maxDist ?? 600;
  const DIRS = Array.from({ length: 16 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 8), y: Math.sin((k * Math.PI) / 8) }));
  for (let round = 0; round < 4; round++) {
    const list = [...pos.keys()].filter((id) => movable(id) && troubled(id, pos.get(id)!, true)).sort((a, b) => (deg.get(a) ?? 0) - (deg.get(b) ?? 0));
    if (!list.length) break;
    let changed = false;
    for (const id of list) {
      const r = pos.get(id)!;
      if (!troubled(id, r, true)) continue; // 前に動かした物で直った
      let done = false;
      for (let d = 6; d <= maxDist && !done; d += 6) {
        for (const dir of DIRS) {
          const cand = { ...r, x: Math.round(r.x + dir.x * d), y: Math.round(r.y + dir.y * d) };
          if (!okAt(id, cand)) continue;
          pos.set(id, cand);
          moved.set(id, { x: cand.x, y: cand.y });
          unresolved.delete(id);
          done = changed = true;
          break;
        }
      }
      if (!done) unresolved.add(id);
    }
    if (!changed) break;
  }
  return { moves: moved, unresolved: [...unresolved] };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 選んだ物を同じ割合で動かし、移動中に新しい重なりが生じる手前までで止める。 */
export function spreadFrom(items: ArrItem[], factor: number, obstacles: ArrItem[] = []): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length < 2) return out;
  const x0 = Math.min(...items.map((i) => i.r.x)), y0 = Math.min(...items.map((i) => i.r.y));
  const x1 = Math.max(...items.map((i) => i.r.x + i.r.w)), y1 = Math.max(...items.map((i) => i.r.y + i.r.h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const moving = items.map(({ id, r }) => {
    const c = center(r);
    return { id, r, dx: (c.x - cx) * (factor - 1), dy: (c.y - cy) * (factor - 1) };
  });
  const bodies = [...moving, ...obstacles.map(({ r }) => ({ r, dx: 0, dy: 0 }))];
  // 2つの箱が各軸で重なる時間の範囲。両軸の範囲が重なった時刻に衝突する。
  type Interval = [number, number];
  const interval = (a: number, aw: number, b: number, bw: number, v: number, overlap = 0): Interval => {
    if (overlap >= Math.min(aw, bw)) return [Infinity, -Infinity];
    const low = b - a - aw + overlap, high = b + bw - a - overlap;
    if (!v) return low < 0 && high > 0 ? [-Infinity, Infinity] : [Infinity, -Infinity];
    return v > 0 ? [low / v, high / v] : [high / v, low / v];
  };
  const initialOverlap = (a: number, aw: number, b: number, bw: number) => Math.min(a + aw, b + bw) - Math.max(a, b);
  let limit = 1;
  const stopAt = (x: Interval, y: Interval) => {
    const hit = Math.max(0, x[0], y[0]);
    if (hit < Math.min(limit, x[1], y[1])) limit = hit;
  };
  for (const [i, a] of moving.entries()) {
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const x = (depth = 0) => interval(a.r.x, a.r.w, b.r.x, b.r.w, a.dx - b.dx, depth);
      const y = (depth = 0) => interval(a.r.y, a.r.h, b.r.y, b.r.h, a.dy - b.dy, depth);
      const ox = initialOverlap(a.r.x, a.r.w, b.r.x, b.r.w);
      const oy = initialOverlap(a.r.y, a.r.h, b.r.y, b.r.h);
      if (ox > 0 && oy > 0) {
        // 既存の重なりは残せるが、重なりがさらに深くなる手前で止める。
        stopAt(x(ox), y());
        stopAt(x(), y(oy));
      } else {
        stopAt(x(), y());
      }
    }
    if (!limit) break;
  }
  // 保存時の丸めで、移動しすぎないようにする。
  for (const { id, r, dx, dy } of moving) {
    const x = r.x + Math.trunc(dx * limit), y = r.y + Math.trunc(dy * limit);
    if (x !== r.x || y !== r.y) out.set(id, { x, y });
  }
  return out;
}

/** 選んだ物をそろえる: 縦 = 左をそろえて上から順に、横 = 上をそろえて左から順に(順番は今の並びのまま) */
export function alignItems(items: ArrItem[], axis: "v" | "h", spacing = axis === "v" ? 12 : 28): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length < 2) return out;
  if (axis === "v") {
    const sorted = [...items].sort((a, b) => a.r.y - b.r.y);
    const x = Math.min(...items.map((i) => i.r.x));
    let y = sorted[0].r.y;
    for (const i of sorted) {
      out.set(i.id, { x, y });
      y += i.r.h + spacing;
    }
  } else {
    const sorted = [...items].sort((a, b) => a.r.x - b.r.x);
    const y = Math.min(...items.map((i) => i.r.y));
    let x = sorted[0].r.x;
    for (const i of sorted) {
      out.set(i.id, { x, y });
      x += i.r.w + spacing;
    }
  }
  return out;
}

/**
 * 選択範囲の密度を整える。元の向きと近所を基準にし、離れすぎた物は寄せ、詰まった物だけをずらす。
 * 同じノードには同じ角度を使うので、同じ並びに繰り返し実行しても配置が乱れない。
 */
export function organizeItems(items: ArrItem[], obstacles: Rect[], links: ArrLink[]): Map<string, { x: number; y: number }> {
  const moves = new Map<string, { x: number; y: number }>();
  if (items.length < 2) return moves;
  const nearEnough = 124;
  const clearance = 18;
  const ordered = [...items];
  const midpoint = {
    x: (Math.min(...items.map(({ r }) => r.x)) + Math.max(...items.map(({ r }) => r.x + r.w))) / 2,
    y: (Math.min(...items.map(({ r }) => r.y)) + Math.max(...items.map(({ r }) => r.y + r.h))) / 2,
  };
  const density = new Map<string, number>();
  for (const [i, a] of items.entries()) {
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (gap(a.r, b.r) > nearEnough) continue;
      density.set(a.id, (density.get(a.id) ?? 0) + 1);
      density.set(b.id, (density.get(b.id) ?? 0) + 1);
    }
  }
  const distanceTo = (r: Rect, point: { x: number; y: number }) => {
    const c = center(r);
    return Math.hypot(c.x - point.x, c.y - point.y);
  };
  ordered.sort((a, b) => (density.get(b.id) ?? 0) - (density.get(a.id) ?? 0)
    || distanceTo(a.r, midpoint) - distanceTo(b.r, midpoint) || a.id.localeCompare(b.id));
  const origin = center(ordered[0].r);
  const distance = (r: Rect) => distanceTo(r, origin);
  ordered.sort((a, b) => distance(a.r) - distance(b.r));
  const selected = new Set(items.map(({ id }) => id));
  const neighbors = new Map<string, Set<string>>();
  for (const { from, to } of links) {
    if (!selected.has(from) || !selected.has(to)) continue;
    (neighbors.get(from) ?? neighbors.set(from, new Set()).get(from)!).add(to);
    (neighbors.get(to) ?? neighbors.set(to, new Set()).get(to)!).add(from);
  }
  const settled: { id: string; old: Rect; placed: Rect }[] = [];
  const taken = [...obstacles];
  const between = (a: Rect, b: Rect) => distanceTo(a, center(b));
  let crowded = false;
  for (const { id, r } of ordered) {
    let desired = r;
    let reference: (typeof settled)[number] | undefined;
    let score = Infinity;
    let alreadyNear = false;
    for (const other of settled) {
      if (gap(r, other.placed) <= nearEnough) alreadyNear = true;
      const weight = neighbors.get(id)?.has(other.id) ? 0.75 : 1;
      const cost = (gap(r, other.old) + between(r, other.old) * 0.12) * weight;
      if (cost < score) {
        reference = other;
        score = cost;
      }
    }
    const phase = [...id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const angle = (phase / 0x100000000) * Math.PI * 2;
    if (reference && !alreadyNear) {
      const origin = center(reference.placed);
      const from = center(reference.old), end = center(r);
      const dx = end.x - from.x, dy = end.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const offset = Math.sin(angle) * 11;
        const at = (d: number): Rect => ({
          ...r,
          x: Math.round(origin.x + (d * dx - offset * dy) / length - r.w / 2),
          y: Math.round(origin.y + (d * dy + offset * dx) / length - r.h / 2),
        });
        const wanted = 76 + (phase % 29);
        let lo = 0, hi = Math.max(length, Math.hypot(r.w + reference.placed.w, r.h + reference.placed.h) + wanted);
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (gap(at(mid), reference.placed) < wanted) lo = mid;
          else hi = mid;
        }
        desired = at(hi);
      }
    }
    // 残りのノードは後で置く。候補を探す間は、動かさない周囲と配置済みの物だけを障害物にする。
    const searchLimit = 200;
    const near = taken.filter((other) => gap(desired, other) <= searchLimit + clearance);
    const clear = (pos: Rect) => near.every((other) => gap(pos, other) >= clearance);
    let placed = r;
    if (clear(desired)) placed = desired;
    else {
      for (let radius = 12; radius <= searchLimit; radius += 12) {
        let closest: Rect | undefined;
        let cost = Infinity;
        for (let i = 0; i < 18; i++) {
          const a = angle + (i * Math.PI * 2) / 18;
          const candidate = { ...r, x: Math.round(desired.x + Math.cos(a) * radius), y: Math.round(desired.y + Math.sin(a) * radius) };
          if (!clear(candidate)) continue;
          const next = between(candidate, r) * 0.45 + distance(candidate) * 0.15;
          if (next < cost) {
            closest = candidate;
            cost = next;
          }
        }
        if (closest) {
          placed = closest;
          break;
        }
      }
    }
    if (placed === r && taken.some((other) => overlapArea(r, other) > 0)) crowded = true;
    settled.push({ id, old: r, placed });
    taken.push(placed);
    if (placed.x !== r.x || placed.y !== r.y) moves.set(id, { x: placed.x, y: placed.y });
  }
  if (crowded) {
    for (const [i, a] of settled.entries()) {
      for (let j = i + 1; j < settled.length; j++) {
        const b = settled[j];
        if (overlapArea(a.placed, b.placed) > overlapArea(a.old, b.old)) return new Map();
      }
    }
  }
  return moves;
}
