// 書き出し(画像・HTML): いまの画面と同じ並びを、SVG にして PNG や HTML にする
import { groupToMarkdown, labelOf } from "../core/export";
import { ROOT_ID } from "../core/types";
import type { Vault } from "../core/vault";
import { strokeD, type Canvas } from "./canvas";
import { api, toast } from "./ui";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export interface ExportSel {
  ids: string[];
  strokes: string[];
}

export function buildSvg(v: Vault, group: string, canvas: Canvas, sel?: ExportSel): { svg: string; w: number; h: number } {
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
  parts.push(`<defs><marker id="ah" viewBox="0 0 14 12" refX="13" refY="6" markerWidth="15" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0.5 L14,6 L0,11.5 L3.5,6 z" fill="${fg}" fill-opacity="0.75"/></marker></defs>`);
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
      const mk = (l.kind === "arrow" || l.kind === "double" ? ' marker-end="url(#ah)"' : "") + (l.kind === "double" ? ' marker-start="url(#ah)"' : "");
      parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${edge}" stroke-width="1.5"${dash}${mk}/>`);
      if (l.label) parts.push(`<text x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 + 4}" text-anchor="middle" font-size="12" fill="${fg}" paint-order="stroke" stroke="${bg}" stroke-width="8">${esc(l.label)}</text>`);
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
    if (n.type === "text") {
      if (n.fill) parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="${col(n.fill)}" fill-opacity="0.28"/>`);
      const lines = (n.title || "(無題)").split("\n");
      parts.push(text(lines, r.y + 19 + (r.h - lines.length * 22) / 2 - 2, col(n.color)));
    } else if (n.type === "group" || n.type === "note" || n.card) {
      const fillc = n.type === "group" ? grp : card;
      parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${n.type === "group" ? 10 : 8}" fill="${fillc}" stroke="${n.color ? col(n.color) : line}" stroke-width="${n.color ? 2 : 1}"/>`);
      const body = n.type === "note" ? n.body.replace(/\s+/g, " ").trim().slice(0, 40) : "";
      const lab = (n.type === "group" ? "📁 " : "") + labelOf(n);
      parts.push(text([lab], body ? r.y + 26 : r.y + r.h / 2 + 5, fg, "600"));
      if (body) parts.push(text([body], r.y + 50, edge));
    }
    if (i.ref || isAlias) parts.push(`<rect x="${r.x - 4}" y="${r.y - 4}" width="${r.w + 8}" height="${r.h + 8}" rx="6" fill="none" stroke="${edge}" stroke-dasharray="5 4"/>`);
  }
  parts.push("</g>");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
  return { svg, w: W, h: H };
}

async function toPng(svg: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image();
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  try {
    await new Promise<void>((ok, ng) => { img.onload = () => ok(); img.onerror = () => ng(new Error("画像にできませんでした")); img.src = url; });
    const scale = Math.min(2, 8000 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((ok, ng) => c.toBlob((b) => (b ? ok(b) : ng(new Error("画像にできませんでした"))), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    img.src = "";
  }
}

export type ExportKind = "md" | "png" | "html" | "copy";

/** sel を渡すと、選んでいる物(とペンの線)だけを書き出す */
export async function exportGroup(v: Vault, group: string, canvas: Canvas, kind: ExportKind, sel?: ExportSel): Promise<void> {
  const g = v.get(group);
  const base = ((group === ROOT_ID ? g?.title || "ホーム" : g ? labelOf(g) : "ThinkDraw") || "ThinkDraw").replace(/[\\/:*?"<>|\n]/g, "_").slice(0, 60);
  const name = sel ? `${base}-選択` : base;
  const md = () => groupToMarkdown(v, group, 1, new Set(), sel ? new Set(sel.ids) : undefined);
  try {
    if (kind === "copy") {
      await navigator.clipboard.writeText(md());
      toast("Markdown をコピーしました");
      return;
    }
    let path: string | null;
    if (kind === "md") path = await api().exportSave(name + ".md", "Markdown", ["md"], md());
    else {
      const { svg, w, h } = buildSvg(v, group, canvas, sel);
      if (kind === "png") path = await api().exportSave(name + ".png", "画像", ["png"], await toPng(svg, w, h));
      else {
        const html = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title>
<style>body{margin:0;background:#888}.wrap{overflow:auto}details{padding:12px 16px;background:#fff;color:#222;font-family:sans-serif}pre{white-space:pre-wrap}</style></head><body>
<div class="wrap">${svg}</div>
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
