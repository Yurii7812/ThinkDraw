// .md ファイル ⇔ TDNode の読み書き(SPEC 3.2)。
// 読むのは yaml ライブラリ(外部のエディタで書き換えられても読めるように)。
// 書くのは自前(SPEC の例と同じ、1 行 1 項目の見やすい形にそろえるため)。

import YAML from "yaml";
import { LINK_KINDS, type Link, type LinkKind, type Member, type NodeType, type Stroke, type TDNode } from "./types";

const KNOWN = new Set(["id", "title", "type", "color", "fill", "file", "paper", "created", "updated", "members", "refs", "strokes", "links", "card", "spread", "size", "target", "markers"]);
const TYPES: NodeType[] = ["text", "note", "group", "card", "frame", "alias"];

export class ParseError extends Error {}

/** frontmatter と本文に分ける。frontmatter が無ければ null */
export function splitFrontmatter(src: string): { fm: string | null; body: string } {
  const text = src.replace(/^﻿/, "");
  if (!/^---\r?\n/.test(text)) return { fm: null, body: text };
  const start = text.indexOf("\n") + 1;
  const re = /^---[ \t]*$/m;
  re.lastIndex = 0;
  const rest = text.slice(start);
  const m = rest.match(re);
  if (!m || m.index === undefined) return { fm: null, body: text };
  const fm = rest.slice(0, m.index);
  let after = rest.slice(m.index + m[0].length);
  if (after.startsWith("\r\n")) after = after.slice(2);
  else if (after.startsWith("\n")) after = after.slice(1);
  return { fm, body: after };
}

function num(v: unknown, d = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown, d = ""): string {
  if (v === null || v === undefined) return d;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** 枠の大きさ(無い・壊れているときは仮の大きさ) */
function frameSize(v: unknown): { w: number; h: number } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { w: Math.max(40, num(o.w, 240)), h: Math.max(30, num(o.h, 160)) };
}

/** ファイルの中身を読む。fallbackId はファイル名から取った ID */
export function parseNode(src: string, fallbackId: string): TDNode {
  const { fm, body } = splitFrontmatter(src);
  let data: Record<string, unknown> = {};
  if (fm !== null) {
    try {
      const v = YAML.parse(fm);
      if (v && typeof v === "object" && !Array.isArray(v)) data = v as Record<string, unknown>;
    } catch (e) {
      throw new ParseError(`frontmatter を読めません (${fallbackId}): ${(e as Error).message}`);
    }
  }
  const type = TYPES.includes(data.type as NodeType) ? (data.type as NodeType) : fm === null ? "note" : "text";
  const posList = (v: unknown): Member[] =>
    Array.isArray(v)
      ? (v as unknown[])
          .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && "id" in (m as object))
          .map((m) => {
            const o: Member = { id: str(m.id), x: num(m.x), y: num(m.y) };
            if (typeof m.w === "number" && m.w > 0) o.w = m.w;
            return o;
          })
      : [];
  const members = posList(data.members);
  const refs = posList(data.refs);
  const strokes: Stroke[] = Array.isArray(data.strokes)
    ? (data.strokes as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => {
          const pts = str(s.p).trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
          const out: Stroke = { id: str(s.id), c: Math.max(0, Math.trunc(num(s.c))), w: Math.max(0.5, num(s.w, 3)), p: pts.length % 2 ? pts.slice(0, -1) : pts };
          if (s.hl === true) out.hl = true;
          return out;
        })
        .filter((s) => s.id && s.p.length >= 2)
    : [];
  const links: Link[] = Array.isArray(data.links)
    ? (data.links as unknown[])
        .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && "to" in (l as object))
        .map((l) => {
          const kind = LINK_KINDS.includes(l.kind as LinkKind) ? (l.kind as LinkKind) : "line";
          const out: Link = { to: str(l.to), kind };
          if (l.label !== undefined && l.label !== null && str(l.label) !== "") out.label = str(l.label);
          if (typeof l.color === "number" && l.color > 0) out.color = Math.trunc(l.color);
          if (typeof l.at === "number" && l.at >= 0 && l.at <= 1) out.at = l.at;
          if (typeof l.size === "number" && l.size > 0) out.size = l.size;
          return out;
        })
    : [];
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN.has(k)) extra[k] = v;

  const node: TDNode = {
    id: str(data.id, fallbackId) || fallbackId,
    title: str(data.title),
    type,
    color: Math.max(0, Math.trunc(num(data.color))),
    ...(num(data.fill) > 0 ? { fill: Math.trunc(num(data.fill)) } : {}),
    ...(/^assets\/[^\n]+$/.test(str(data.file)) ? { file: str(data.file) } : {}),
    ...(/^p[0-9a-f]{12}$/.test(str(data.paper)) ? { paper: str(data.paper) } : {}),
    ...(type === "frame" || (type === "group" && data.size) ? { size: frameSize(data.size) } : {}),
    ...(type === "alias" && str(data.target) ? { target: str(data.target) } : {}),
    ...(type === "group" && Array.isArray(data.markers) && data.markers.length ? { markers: [...new Set((data.markers as unknown[]).map((m) => str(m).trim()).filter(Boolean))] } : {}),
    created: str(data.created),
    updated: str(data.updated),
    members,
    refs,
    strokes,
    links,
    body,
    extra,
  };
  if (data.card && typeof data.card === "object") {
    const c = data.card as Record<string, unknown>;
    node.card = { deck: str(c.deck, "tarot"), id: str(c.id), reversed: c.reversed === true };
    if (Array.isArray(c.moving)) node.card.moving = (c.moving as unknown[]).map((x) => Math.trunc(num(x))).filter((x) => x >= 0 && x <= 5);
  }
  if (data.spread && typeof data.spread === "object") {
    const s = data.spread as Record<string, unknown>;
    node.spread = { run: str(s.run) };
    if (s.pos !== undefined && s.pos !== null) node.spread.pos = str(s.pos);
    if (s.spread !== undefined && s.spread !== null) node.spread.spread = str(s.spread);
  }
  // ファイル名と frontmatter の ID が食い違ったら、ファイル名を正とする(リンクはファイル名で張られるため)
  node.id = fallbackId;
  return node;
}

/** スカラーを YAML に書く。素のまま書いて同じ値に読み戻せるときだけ素で書く */
function scalar(v: string | number | boolean): string {
  if (typeof v !== "string") return String(v);
  if (v === "") return '""';
  if (!/[\n\r\t]/.test(v) && !/^\s|\s$/.test(v)) {
    try {
      const back = YAML.parse(`k: ${v}`);
      if (back && back.k === v) return v;
    } catch {
      /* 素では書けない */
    }
  }
  return JSON.stringify(v); // JSON の文字列は YAML の二重引用符の文字列としても正しい
}

/** 流れ形式 { a: 1, b: x } の中の値。カンマや括弧があっても壊れないよう、文字列は ID 以外は引用符で囲む */
function flowScalar(v: string | number | boolean): string {
  if (typeof v !== "string") return String(v);
  if (/^[a-z0-9_-]+$/i.test(v) && scalar(v) === v) return v;
  return JSON.stringify(v);
}
function flowMap(o: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${flowScalar(v as string | number | boolean)}`);
  return `{ ${parts.join(", ")} }`;
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function serializeNode(n: TDNode): string {
  const L: string[] = ["---"];
  L.push(`id: ${scalar(n.id)}`);
  L.push(`title: ${scalar(n.title)}`);
  L.push(`type: ${n.type}`);
  if (n.color) L.push(`color: ${n.color}`);
  if (n.fill) L.push(`fill: ${n.fill}`);
  if (n.file) L.push(`file: ${scalar(n.file)}`);
  if (n.paper) L.push(`paper: ${scalar(n.paper)}`);
  if ((n.type === "frame" || n.type === "group") && n.size) L.push(`size: { w: ${Math.round(n.size.w)}, h: ${Math.round(n.size.h)} }`);
  if (n.type === "alias" && n.target) L.push(`target: ${scalar(n.target)}`);
  if (n.type === "group" && n.markers?.length) L.push(`markers: [${n.markers.map((m) => flowScalar(m)).join(", ")}]`);
  if (n.created) L.push(`created: ${scalar(n.created)}`);
  if (n.updated) L.push(`updated: ${scalar(n.updated)}`);
  if (n.type === "group") {
    if (n.members.length === 0) L.push("members: []");
    else {
      L.push("members:");
      for (const m of n.members) L.push(`  - ${flowMap({ id: m.id, x: round(m.x), y: round(m.y), w: m.w === undefined ? undefined : round(m.w) })}`);
    }
    if (n.refs.length) {
      L.push("refs:");
      for (const m of n.refs) L.push(`  - ${flowMap({ id: m.id, x: round(m.x), y: round(m.y), w: m.w === undefined ? undefined : round(m.w) })}`);
    }
    if (n.strokes.length) {
      L.push("strokes:");
      for (const s of n.strokes) {
        const pts: string[] = [];
        for (let i = 0; i + 1 < s.p.length; i += 2) pts.push(`${Math.round(s.p[i])},${Math.round(s.p[i + 1])}`);
        L.push(`  - ${flowMap({ id: s.id, c: s.c, w: round(s.w), hl: s.hl ? true : undefined, p: pts.join(" ") })}`);
      }
    }
  }
  if (n.links.length) {
    L.push("links:");
    for (const l of n.links) L.push(`  - ${flowMap({ to: l.to, kind: l.kind, label: l.label, color: l.color || undefined, at: l.at === undefined ? undefined : Math.round(l.at * 1000) / 1000, size: l.size })}`);
  }
  if (n.card) {
    L.push("card:");
    L.push(`  deck: ${scalar(n.card.deck)}`);
    L.push(`  id: ${scalar(n.card.id)}`);
    L.push(`  reversed: ${n.card.reversed}`);
    if (n.card.moving?.length) L.push(`  moving: [${n.card.moving.join(", ")}]`);
  }
  if (n.spread) {
    L.push("spread:");
    L.push(`  run: ${scalar(n.spread.run)}`);
    if (n.spread.pos !== undefined) L.push(`  pos: ${scalar(n.spread.pos)}`);
    if (n.spread.spread !== undefined) L.push(`  spread: ${scalar(n.spread.spread)}`);
  }
  const extraKeys = Object.keys(n.extra);
  if (extraKeys.length) {
    const doc = YAML.stringify(n.extra).trimEnd();
    L.push(doc);
  }
  L.push("---");
  return L.join("\n") + "\n" + n.body;
}
