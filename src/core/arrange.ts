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

/** 選んだ物の間かくだけを広げる・狭める(真ん中を動かさない。文字の大きさは変えない) */
export function spreadFrom(items: ArrItem[], factor: number): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length < 2) return out;
  const x0 = Math.min(...items.map((i) => i.r.x)), y0 = Math.min(...items.map((i) => i.r.y));
  const x1 = Math.max(...items.map((i) => i.r.x + i.r.w)), y1 = Math.max(...items.map((i) => i.r.y + i.r.h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const i of items) {
    const c = center(i.r);
    out.set(i.id, { x: Math.round(cx + (c.x - cx) * factor - i.r.w / 2), y: Math.round(cy + (c.y - cy) * factor - i.r.h / 2) });
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
