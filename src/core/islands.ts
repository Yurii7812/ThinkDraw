// 全体の「島」(2026-11-23 利用者と決めた A2):
// 各グループのキャンバスを、開いたときと同じ位置・見た目・線のまま「島」として並べる。
// 今のグループの島はいつものキャンバスそのまま。ほかの島は、つながりの近い順に、たどってきた島の外側へ置く。
// 範囲: 0 = このグループだけ、1 = ＋1 段、2 = ＋2 段、Infinity = 全部(ホームからの所属で全部つながっている)。
import { gap, type Rect } from "./placement";
import { ROOT_ID } from "./types";
import type { Vault } from "./vault";

export interface IslandPick {
  group: string;
  dist: number; // 今のグループからの段の数(0 = 今)
  from: string | null; // どの島からたどってきたか
  rel: "up" | "down" | "side"; // from から見て、上(所属先)・下(中のグループ)・横(引用・リンク)
}

const MAX_ISLANDS = 300;

/** 今のグループから、範囲の段までのグループを、近い順に */
export function pickIslands(v: Vault, group: string, depth: number): IslandPick[] {
  const isGroup = (id: string) => id === ROOT_ID || v.get(id)?.type === "group";
  const out: IslandPick[] = [{ group, dist: 0, from: null, rel: "side" }];
  const seen = new Set([group]);
  let level = [group];
  for (let d = 1; d <= depth && level.length && out.length < MAX_ISLANDS; d++) {
    const next: string[] = [];
    const add = (g: string, from: string, rel: IslandPick["rel"]) => {
      if (seen.has(g) || !isGroup(g) || !v.exists(g) || out.length >= MAX_ISLANDS) return;
      seen.add(g);
      out.push({ group: g, dist: d, from, rel });
      next.push(g);
    };
    for (const g of level) {
      for (const p of v.parentsOf(g)) add(p, g, "up");
      for (const q of v.quotedBy(g)) add(q, g, "up");
      const items = v.itemsOf(g).filter((i) => v.exists(i.id));
      for (const i of items) if (!i.ref && isGroup(i.id)) add(i.id, g, "down");
      for (const i of items) {
        if (isGroup(i.id)) continue;
        // 引用の元・ほかの所属先・引用している所
        for (const p of [...v.parentsOf(i.id), ...v.quotedBy(i.id)]) add(p, g, "side");
        // 線でつながる相手のグループ
        const n = v.get(i.id)!;
        for (const t of [...n.links.map((l) => l.to), ...v.backlinksOf(i.id)]) for (const p of v.parentsOf(t)) add(p, g, "side");
      }
    }
    level = next;
  }
  return out;
}

/**
 * 島を置く。center = 今の島の箱(動かさない)。sizes = ほかの島の大きさ。
 * たどってきた島の外側(今の島から遠ざかる向き。今の島から直接なら、上・下・横)に、重ならないよう置く。
 */
export function placeIslands(picks: IslandPick[], center: Rect, sizes: Map<string, { w: number; h: number }>, margin = 70): Map<string, Rect> {
  const boxes = new Map<string, Rect>();
  boxes.set(picks[0].group, center);
  const placed: Rect[] = [center];
  const cc = { x: center.x + center.w / 2, y: center.y + center.h / 2 };
  let side = 0;
  for (const p of picks.slice(1)) {
    const s = sizes.get(p.group) ?? { w: 200, h: 120 };
    const fromBox = (p.from && boxes.get(p.from)) || center;
    const fc = { x: fromBox.x + fromBox.w / 2, y: fromBox.y + fromBox.h / 2 };
    let dir: { x: number; y: number };
    if (p.from === picks[0].group || !p.from) {
      if (p.rel === "up") dir = { x: 0, y: -1 };
      else if (p.rel === "down") dir = { x: 0, y: 1 };
      else dir = { x: side++ % 2 ? -1 : 1, y: 0 };
    } else {
      const dx = fc.x - cc.x, dy = fc.y - cc.y;
      const len = Math.hypot(dx, dy) || 1;
      dir = { x: dx / len, y: dy / len };
    }
    // 向きの先の、たどってきた島のすぐ外を出発点に、まわりへ少しずつ探して、空いている所に置く
    const reach = (Math.abs(dir.x) * (fromBox.w + s.w)) / 2 + (Math.abs(dir.y) * (fromBox.h + s.h)) / 2 + margin;
    const px = fc.x + dir.x * reach - s.w / 2, py = fc.y + dir.y * reach - s.h / 2;
    let best: Rect | null = null;
    for (let ring = 0; ring < 60 && !best; ring++) {
      const r = ring * 60;
      const steps = ring === 0 ? 1 : 8 + ring * 4;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const cand = { x: Math.round(px + Math.cos(a) * r), y: Math.round(py + Math.sin(a) * r), w: s.w, h: s.h };
        if (placed.every((b) => gap(cand, b) >= margin * 0.6)) {
          best = cand;
          break;
        }
      }
    }
    const box = best ?? { x: Math.round(px), y: Math.round(py), w: s.w, h: s.h };
    boxes.set(p.group, box);
    placed.push(box);
  }
  return boxes;
}
