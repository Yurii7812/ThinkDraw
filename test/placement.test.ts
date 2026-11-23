import { describe, expect, it } from "vitest";
import { gap, placeAround, type Rect } from "../src/core/placement";

function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe("Tab・Enter の置き場所", () => {
  it("何度足しても、すでにあるものと重ならず、間を空ける", () => {
    const parent: Rect = { x: 0, y: 0, w: 80, h: 26 };
    const placed: Rect[] = [];
    const rand = seeded(1);
    for (let i = 0; i < 12; i++) {
      const p = placeAround(parent, placed, { rand });
      const me = { ...p, w: 90, h: 26 };
      for (const o of [parent, ...placed]) expect(gap(me, o)).toBeGreaterThan(20);
      placed.push(me);
    }
    // 全方向に広がる(上にも下にも左にも右にもある)
    const cx = (r: Rect) => r.x + r.w / 2, cy = (r: Rect) => r.y + r.h / 2;
    expect(placed.some((r) => cx(r) < 0)).toBe(true);
    expect(placed.some((r) => cx(r) > 80)).toBe(true);
    expect(placed.some((r) => cy(r) < 0)).toBe(true);
    expect(placed.some((r) => cy(r) > 26)).toBe(true);
  });
  it("遠すぎない(最初の 1 つは親のそば)", () => {
    const p = placeAround({ x: 0, y: 0, w: 80, h: 26 }, [], { rand: seeded(3) });
    expect(Math.hypot(p.x, p.y)).toBeLessThan(300);
  });
  it("ちょっとランダム(同じ状況でも毎回同じではない)", () => {
    const parent: Rect = { x: 0, y: 0, w: 80, h: 26 };
    const set = new Set<string>();
    for (let s = 1; s < 20; s++) {
      const p = placeAround(parent, [], { rand: seeded(s) });
      set.add(`${p.x},${p.y}`);
    }
    expect(set.size).toBeGreaterThan(3);
  });
});

import { freeOffset } from "../src/core/placement";
describe("まとめて置くときに重ならない", () => {
  it("すでにある物を避けて、一番近い空いた所へ", () => {
    const obs: Rect[] = [{ x: 0, y: 0, w: 300, h: 300 }];
    const o = freeOffset([{ x: 50, y: 50, w: 100, h: 100 }], obs);
    const moved = { x: 50 + o.dx, y: 50 + o.dy, w: 100, h: 100 };
    expect(gap(moved, obs[0])).toBeGreaterThan(0);
    expect(Math.hypot(o.dx, o.dy)).toBeLessThan(400);
    expect(freeOffset([{ x: 500, y: 500, w: 10, h: 10 }], obs)).toEqual({ dx: 0, dy: 0 });
  });
});

import { segHitsRect } from "../src/core/placement";
it("線分が長方形を通るか", () => {
  const r = { x: 10, y: 10, w: 20, h: 10 };
  expect(segHitsRect(0, 15, 50, 15, r)).toBe(true);
  expect(segHitsRect(0, 0, 50, 0, r)).toBe(false);
  expect(segHitsRect(0, 0, 5, 5, r)).toBe(false);
  expect(segHitsRect(0, 40, 40, 0, r)).toBe(true);
});
