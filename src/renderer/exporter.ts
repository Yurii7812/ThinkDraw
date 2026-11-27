// 書き出し(画像・HTML): いまの画面と同じ並びを、SVG にして PNG や HTML にする
import { groupToMarkdown, labelOf } from "../core/export";
import { toJsonCanvas, toOpml, toOutlineText } from "../core/share";
import { edgeEnds, partEnd } from "./edgeshape";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";
import { strokeD, type Canvas } from "./canvas";
import { api, toast } from "./ui";
import { cardDef, spreadDef } from "../decks";
import { CARD_H } from "../core/spreadLayout";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export interface ExportSel {
  ids: string[];
  strokes: string[];
}

const IMG_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif" };
function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(bin);
}
/** 添付した画像を、書き出しの SVG に埋め込める形(data URL)で読み込む。id → data URL */
export async function loadImages(v: Vault, group: string, sel?: ExportSel): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const only = sel ? new Set(sel.ids) : null;
  await Promise.all(
    v.itemsOf(group).map(async (i) => {
      const n0 = v.get(i.id);
      const n = n0?.type === "alias" && n0.target ? v.get(n0.target) : n0;
      if (!n || (only && !only.has(i.id))) return;
      // タロットのカードの絵(2026-11-25 利用者「画像で出力するときにタロットの絵柄が出ない」)
      const def = n.type === "card" && n.card?.deck === "tarot" ? cardDef("tarot", n.card.id) : undefined;
      if (def) {
        try {
          const bytes = await api().deckImage("tarot", def.file);
          if (bytes) out.set(i.id, `data:${IMG_MIME[(def.file.split(".").pop() ?? "jpg").toLowerCase()] ?? "image/jpeg"};base64,${b64(bytes)}`);
        } catch {
          /* 読めないときは名前の文字で出す */
        }
        return;
      }
      if (n.type !== "text" || !n.file) return;
      const mime = IMG_MIME[(n.file.split(".").pop() ?? "").toLowerCase()];
      if (!mime) return;
      try {
        const bytes = await api().readAsset(n.file);
        if (!bytes) return;
        out.set(i.id, `data:${mime};base64,${b64(bytes)}`);
      } catch {
        /* 読めない画像は、名前の文字で出す */
      }
    }),
  );
  return out;
}

export function buildSvg(v: Vault, group: string, canvas: Canvas, sel?: ExportSel, images: Map<string, string> = new Map()): { svg: string; w: number; h: number } {
  const bg = css("--bg"), fg = css("--fg"), edge = css("--edge"), line = css("--line"), grp = css("--group"), card = css("--card");
  const col = (c: number) => (c ? css(`--c${c}`) : fg);
  const onlyIds = sel ? new Set(sel.ids) : null;
  const onlyStrokes = sel ? new Set(sel.strokes) : null;
  const items = v.itemsOf(group).filter((i) => v.exists(i.id) && canvas.rectOf(i.id) && (!onlyIds || onlyIds.has(i.id)));
  const strokes = v.strokesOf(group).filter((s) => !onlyStrokes || onlyStrokes.has(s.id));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  };
  for (const i of items) { const r = canvas.rectOf(i.id)!; grow(r.x, r.y, r.w, r.h); }
  for (const s of strokes) for (let k = 0; k + 1 < s.p.length; k += 2) grow(s.p[k], s.p[k + 1], 0, 0);
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 100; }
  const pad = 40;
  const W = Math.ceil(x1 - x0 + pad * 2), H = Math.ceil(y1 - y0 + pad * 2);
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
  parts.push(`<g transform="translate(${pad - x0},${pad - y0})" font-family="sans-serif" font-size="15">`);
  const clip = (r: { x: number; y: number; w: number; h: number }, tx: number, ty: number) => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
    return { x: cx + dx * s, y: cy + dy * s };
  };
  // 枠は一番下に
  for (const i of items) {
    const n = v.get(i.id)!;
    if (n.type !== "frame") continue;
    const r = canvas.rectOf(i.id)!;
    parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="12" fill="none" stroke="${n.color ? col(n.color) : edge}" stroke-width="1.5"/>`);
    if (n.title) parts.push(`<text x="${r.x + 18}" y="${r.y + 4}" font-size="12" fill="${edge}" paint-order="stroke" stroke="${bg}" stroke-width="6">${esc(n.title)}</text>`);
  }
  for (const i of items) {
    const a = canvas.rectOf(i.id)!;
    for (const l of v.get(i.id)!.links) {
      const b = canvas.rectOf(l.to);
      if (!b) continue;
      const p1 = clip(a, b.x + b.w / 2, b.y + b.h / 2), p2 = clip(b, a.x + a.w / 2, a.y + a.h / 2);
      const dash = l.kind === "dashed" ? ' stroke-dasharray="6 5"' : "";
      const c0 = canvas.linkColor(l); // 付けた色、無ければ種類のいつもの色
      const lc = c0 ? col(c0) : l.kind === "oppose" ? css("--danger") : edge;
      const e = edgeEnds(l.kind, p1, l.kind === "part" ? partEnd(b, p1, p2) : p2);
      parts.push(`<line x1="${e.start.x}" y1="${e.start.y}" x2="${e.end.x}" y2="${e.end.y}" stroke="${lc}" stroke-width="${l.kind === "thick" ? 4 : 1.5}"${dash}/>`);
      if (e.fill) parts.push(`<path d="${e.fill}" fill="${lc}"/>`);
      if (e.stroke) parts.push(`<path d="${e.stroke}" fill="none" stroke="${lc}" stroke-width="2"/>`);
      if (l.label) {
        // 線の文字: 文章と同じ大きさ・薄い灰色の背景(統合仕様 6)
        const at = Math.min(0.85, Math.max(0.15, l.at ?? 0.5));
        const lx = p1.x + (p2.x - p1.x) * at, ly = p1.y + (p2.y - p1.y) * at;
        const fs = l.size ?? 15;
        const w = [...l.label].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? fs : fs * 0.6), 0) + 14;
        parts.push(`<rect x="${lx - w / 2}" y="${ly - fs * 0.75 - 3}" width="${w}" height="${fs * 1.5 + 6}" rx="4" fill="${css("--label-bg") || "#e6e6e3"}"/>`);
        parts.push(`<text x="${lx}" y="${ly + fs * 0.35}" text-anchor="middle" font-size="${fs}" fill="${fg}">${esc(l.label)}</text>`);
      }
    }
  }
  for (const s of strokes) {
    parts.push(`<path d="${strokeD(s.p)}" fill="none" stroke="${col(s.c)}" stroke-width="${s.hl ? s.w * 2 : s.w}" stroke-linecap="round" stroke-linejoin="round"${s.hl ? ' opacity="0.35"' : ""}/>`);
  }
  for (const i of items) {
    const n0 = v.get(i.id)!, r = canvas.rectOf(i.id)!;
    const isAlias = n0.type === "alias";
    const n = isAlias && n0.target && v.get(n0.target) ? v.get(n0.target)! : n0;
    const cx = r.x + r.w / 2;
    const text = (lines: string[], y: number, color: string, weight = "normal") =>
      lines.map((t, k) => `<text x="${cx}" y="${y + k * 22}" text-anchor="middle" fill="${color}" font-weight="${weight}">${esc(t)}</text>`).join("");
    if (n.type === "text" && images.has(i.id)) {
      parts.push(`<image x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="xMidYMid meet" href="${images.get(i.id)}"/>`);
    } else if (n.type === "text") {
      if (n.fill) parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="${col(n.fill)}" fill-opacity="0.28"/>`);
      const lines = (n.title || "(無題)").split("\n");
      parts.push(text(lines, r.y + 19 + (r.h - lines.length * 22) / 2 - 2, col(n.color)));
    } else if (n.type === "card" && images.has(i.id)) {
      // タロット: 絵(逆位置は逆さ)と、その下に名前・位置の名前
      const fh = CARD_H, cxm = r.x + r.w / 2, cym = r.y + fh / 2;
      const rot = n.card?.reversed ? ` transform="rotate(180 ${cxm} ${cym})"` : "";
      parts.push(`<image x="${r.x}" y="${r.y}" width="${r.w}" height="${fh}" preserveAspectRatio="xMidYMid slice" href="${images.get(i.id)}"${rot}/>`);
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${fh}" rx="6" fill="none" stroke="${n.color ? col(n.color) : line}" stroke-width="${n.color ? 3 : 1}"/>`);
      parts.push(`<text x="${cxm}" y="${r.y + fh + 16}" text-anchor="middle" fill="${fg}" font-size="12">${esc(labelOf(n))}</text>`);
      const pos = n.spread?.pos ? spreadDef("tarot", n.spread.spread)?.pos.find((p) => p.id === n.spread!.pos) : undefined;
      if (pos) parts.push(`<text x="${cxm}" y="${r.y + fh + 31}" text-anchor="middle" fill="${edge}" font-size="11">${esc(pos.name)}</text>`);
    } else if (n.type === "group" || n.type === "note" || n.card) {
      const fillc = n.type === "group" ? grp : card;
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${n.type === "group" ? 10 : 8}" fill="${fillc}" stroke="${n.color ? col(n.color) : line}" stroke-width="${n.color ? 2 : 1}"/>`);
      const body = n.type === "note" ? n.body.replace(/\s+/g, " ").trim().slice(0, 40) : "";
      const lab = (n.type === "group" ? "📁 " : "") + labelOf(n);
      parts.push(text([lab], body ? r.y + 26 : r.y + r.h / 2 + 5, fg, "600"));
      if (body) parts.push(text([body], r.y + 50, edge));
    }
    if (i.ref || isAlias) parts.push(`<rect x="${r.x - 4}" y="${r.y - 4}" width="${r.w + 8}" height="${r.h + 8}" rx="6" fill="none" stroke="#3f9f5f" stroke-width="2"/>`); // 引用は緑の枠(修正11)
  }
  parts.push("</g>");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
  return { svg, w: W, h: H };
}

/** 画像の画質: 大きさの倍率(1〜4)と JPEG の品質(0.5〜1) */
export interface ImageOpts {
  scale: number;
  quality: number;
}
export const DEFAULT_IMAGE: ImageOpts = { scale: 2, quality: 0.9 };

export type ExportKind = "md" | "png" | "jpg" | "html" | "copy" | "canvas" | "outline" | "opml" | "copyOutline";

/** sel を渡すと、選んでいる物(とペンの線)だけを書き出す */
export async function exportGroup(v: Vault, group: string, canvas: Canvas, kind: ExportKind, sel?: ExportSel, img: ImageOpts = DEFAULT_IMAGE): Promise<void> {
  const g = v.get(group);
  const base = ((group === ROOT_ID ? g?.title || "ホーム" : g ? labelOf(g) : "bresuto") || "bresuto").replace(/[\\/:*?"<>|\n]/g, "_").slice(0, 60);
  const name = sel ? `${base}-選択` : base;
  const md = () => groupToMarkdown(v, group, 1, new Set(), sel ? new Set(sel.ids) : undefined);
  try {
    if (kind === "copy") {
      await navigator.clipboard.writeText(md());
      toast("Markdown をコピーしました");
      return;
    }
    let path: string | null;
    const only = sel ? new Set(sel.ids) : undefined;
    const rect = (id: string) => canvas.rectOf(id);
    if (kind === "copyOutline") {
      await navigator.clipboard.writeText(toOutlineText(v, group, rect, only));
      toast("網の箇条書きをコピーしました(bresuto に Ctrl+Q で貼ると同じ図に戻ります)");
      return;
    }
    if (kind === "canvas") path = await api().exportSave(name + ".canvas", "JSON Canvas", ["canvas"], toJsonCanvas(v, group, rect, only));
    else if (kind === "outline") path = await api().exportSave(name + ".md", "箇条書き", ["md"], toOutlineText(v, group, rect, only));
    else if (kind === "opml") path = await api().exportSave(name + ".opml", "OPML", ["opml"], toOpml(v, group, rect, base, only));
    else if (kind === "md") path = await api().exportSave(name + ".md", "Markdown", ["md"], md());
    else {
      // 画面に見えているとおりに写す(2026-11-27 利用者。前は別に描き直していて見た目が違った)
      const shot = await canvas.capture(img.scale, sel);
      const blobOf = (type: string, q?: number) => new Promise<Blob>((ok, ng) => shot.toBlob((b) => (b ? ok(b) : ng(new Error("画像にできませんでした"))), type, q));
      const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
      if (kind === "png") path = await api().exportSave(name + ".png", "画像", ["png"], await bytes(await blobOf("image/png")));
      else if (kind === "jpg") path = await api().exportSave(name + ".jpg", "画像", ["jpg"], await bytes(await blobOf("image/jpeg", Math.min(1, Math.max(0.1, img.quality)))));
      else {
        const dataUrl = shot.toDataURL("image/png");
        const html = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title>
<style>body{margin:0;background:#888}.wrap{overflow:auto}.wrap img{display:block;width:${Math.round(shot.width / Math.max(0.25, img.scale))}px;max-width:none}details{padding:12px 16px;background:#fff;color:#222;font-family:sans-serif}pre{white-space:pre-wrap}</style></head><body>
<div class="wrap"><img src="${dataUrl}" alt="${esc(name)}"></div>
<details><summary>文章で読む(Markdown)</summary><pre>${esc(md())}</pre></details>
</body></html>\n`;
        path = await api().exportSave(name + ".html", "HTML", ["html"], html);
      }
    }
    if (path) toast("書き出しました: " + path);
  } catch (e) {
    toast("書き出せませんでした: " + (e as Error).message);
  }
}
