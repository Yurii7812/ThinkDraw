// スプレッドの配置の計算(SPEC 第 7 章)。画面の中心に、スプレッドの形を保ったまま置く。

export const CARD_W = 110;
export const CARD_H = Math.round((CARD_W * 600) / 360); // 画像は 360×600

export interface SpreadPos {
  id: string;
  name: string;
  x: number; // カードの中心(スプレッドの定義の座標系)
  y: number;
  hint: string;
}
export interface SpreadDef {
  id: string;
  name: string;
  cw: number; // 定義の座標系でのカードの幅
  pos: SpreadPos[];
}
export interface Placement {
  pos: SpreadPos | null; // 自由に引いたときは null
  x: number; // キャンバスでのカードの左上
  y: number;
}

/** 決まったスプレッドの配置。center はキャンバスの座標 */
export function placeSpread(s: SpreadDef, center: { x: number; y: number }, cardW = CARD_W, cardH = CARD_H): Placement[] {
  const k = cardW / s.cw;
  const xs = s.pos.map((p) => p.x);
  const ys = s.pos.map((p) => p.y);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const my = (Math.min(...ys) + Math.max(...ys)) / 2;
  return s.pos.map((p) => ({
    pos: p,
    x: Math.round(center.x + (p.x - mx) * k - cardW / 2),
    y: Math.round(center.y + (p.y - my) * k - cardH / 2),
  }));
}

/** 枚数を指定して自由に引く: 1 段に最大 7 枚で並べる */
export function placeFree(count: number, center: { x: number; y: number }, cardW = CARD_W, cardH = CARD_H): Placement[] {
  const perRow = Math.min(7, Math.max(1, count));
  const rows = Math.ceil(count / perRow);
  const gapX = Math.round(cardW * 1.3);
  const gapY = cardH + 40;
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / perRow);
    const inRow = r === rows - 1 ? count - r * perRow : perRow;
    const c = i % perRow;
    const x = center.x + (c - (inRow - 1) / 2) * gapX - cardW / 2;
    const y = center.y + (r - (rows - 1) / 2) * gapY - cardH / 2;
    out.push({ pos: null, x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/** 山札から n 枚、重複なしで引く。rand は [0, max) の整数(暗号論的な乱数を渡す) */
export function drawCards<T>(deck: T[], n: number, rand: (max: number) => number): T[] {
  const a = [...deck];
  // フィッシャー–イェーツ(先頭 n 枚だけ確定させる)
  for (let i = 0; i < Math.min(n, a.length); i++) {
    const j = i + rand(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
