import { describe, expect, it } from "vitest";
import { doneTaskIds, emptyPhoneState, importPhone, setTaskLine, type PhoneHost } from "../src/core/phoneimport";

const enc = new TextEncoder();
const f = (name: string, d: unknown) => ({ name, data: enc.encode(JSON.stringify(d)) });
function fakeHost() {
  const nodes = new Map<string, { title: string; body: string; near?: string | null }>();
  const links: [string, string][] = [];
  const records = new Map<string, string>();
  const attached: string[] = [];
  const kinds: string[] = [];
  let n = 0;
  const mk = (title: string, body: string, near: string | null = null) => {
    const id = "n" + ++n;
    nodes.set(id, { title, body, near });
    return id;
  };
  const host: PhoneHost = {
    recordNote: (ymd, kind) => records.get(ymd + kind) ?? (records.set(ymd + kind, mk(`${ymd}-${kind}`, "")), records.get(ymd + kind)!),
    appendBody: (id, t) => (nodes.get(id)!.body += (nodes.get(id)!.body ? "\n\n" : "") + t),
    placeNote: (title, body, near) => mk(title, body, near),
    updateNote: (id, title, body) => Object.assign(nodes.get(id)!, { title, body }),
    link: (a, b) => links.push([a, b]),
    parentOf: (id) => links.find(([, b]) => b === id)?.[0] ?? null,
    exists: (id) => nodes.has(id),
    taskNote: (ex) => (ex && nodes.has(ex) ? ex : mk("スマホのタスク", "")),
    getBody: (id) => nodes.get(id)!.body,
    setBody: (id, b) => (nodes.get(id)!.body = b),
    attachToDay: async (ymd, name) => void attached.push(ymd + "/" + name),
    addKinds: (k) => kinds.push(...k),
  };
  return { host, nodes, links, records, attached, kinds };
}

describe("スマホの取り込み(2026-11-28)", () => {
  it("メモ帳・日記・時系列記録は、その日の記録ノートに時刻つきで", async () => {
    const h = fakeHost(), st = emptyPhoneState();
    const r = await importPhone(
      [f("memo-1.json", { type: "memo", at: "2026-11-28 09:05:00", text: "起きた" }), f("diary-2.json", { type: "diary", kind: "夢", date: "2026-11-27", at: "2026-11-28 07:00:00", text: "空を飛んだ" })],
      st,
      h.host,
    );
    expect(h.nodes.get(h.records.get("2026-11-28メモ")!)!.body).toBe("09:05 起きた");
    expect(h.nodes.get(h.records.get("2026-11-27夢")!)!.body).toBe("07:00 空を飛んだ");
    expect(r.names.sort()).toEqual(["diary-2.json", "memo-1.json"]);
    // 2 回目は取り込まない
    await importPhone([f("memo-1.json", { type: "memo", at: "2026-11-28 09:05:00", text: "起きた" })], st, h.host);
    expect(h.nodes.get(h.records.get("2026-11-28メモ")!)!.body).toBe("09:05 起きた");
  });
  it("ノートは子・横の線つき(子は親から、横は親の親から)。直したノートは取り込み直す", async () => {
    const h = fakeHost(), st = emptyPhoneState();
    await importPhone(
      [
        f("note-3.json", { type: "note", created: "1", updated: "1", body: "子のノート", parentName: "note-1.json", rel: "child" }),
        f("note-1.json", { type: "note", created: "1", updated: "1", body: "# 親のノート\n本文" }),
        f("note-4.json", { type: "note", created: "1", updated: "1", body: "横のノート", parentName: "note-3.json", rel: "sibling" }),
      ],
      st,
      h.host,
    );
    const id = (t: string) => [...h.nodes].find(([, n]) => n.title === t)![0];
    expect(h.links).toEqual([
      [id("親のノート"), id("子のノート")],
      [id("親のノート"), id("横のノート")],
    ]);
    await importPhone([f("note-1.json", { type: "note", created: "1", updated: "2", body: "# 親のノート(直した)" })], st, h.host);
    expect(h.nodes.get(id("親のノート(直した)"))).toBeTruthy();
  });
  it("タスク: チェックリストに足す・済みにする・繰り返しは期限を進める。PC で済んだ物の id", async () => {
    const h = fakeHost(), st = emptyPhoneState();
    await importPhone(
      [
        f("task-1.json", { type: "task", id: "a", text: "牛乳を買う", due: "2026-11-30" }),
        f("task-2.json", { type: "task", id: "b", text: "ゴミ出し", due: "2026-12-01", repeat: "weekly" }),
        f("taskdone-3.json", { type: "taskdone", id: "b", due: "2026-12-01" }),
      ],
      st,
      h.host,
    );
    const body = h.nodes.get(st.taskNote!)!.body;
    expect(body).toBe("- [ ] 牛乳を買う 📅2026-11-30\n- [ ] ゴミ出し 📅2026-12-08 🔁毎週\n");
    // PC で牛乳を済みに → スマホへ返す id
    const pcBody = body.replace("- [ ] 牛乳", "- [x] 牛乳");
    expect(doneTaskIds(pcBody, st)).toEqual(["a"]);
    // スマホで済み
    await importPhone([f("taskdone-9.json", { type: "taskdone", id: "a", due: "2026-11-30" })], st, h.host);
    expect(h.nodes.get(st.taskNote!)!.body).toContain("- [x] 牛乳を買う");
  });
  it("写真はその日のグループへ、紙のカードは紙PKM へ、種類は種類へ", async () => {
    const h = fakeHost(), st = emptyPhoneState();
    const img = { name: "paper-1.jpg", data: new Uint8Array([1, 2]) };
    const r = await importPhone(
      [f("file-1.json", { type: "file", at: "2026-11-28 10:00:00", file: "file-1.jpg", name: "写真.jpg" }), { name: "file-1.jpg", data: new Uint8Array([9]) }, f("paper-1.json", { type: "paper", at: "x", image: "paper-1.jpg" }), img, f("kinds-1.json", { type: "kinds", kinds: ["読書"] })],
      st,
      h.host,
    );
    expect(h.attached).toEqual(["2026-11-28/写真.jpg"]);
    expect(r.papers.map((p) => p.name)).toEqual(["paper-1.jpg"]);
    expect(h.kinds).toEqual(["読書"]);
    expect(r.names).toContain("paper-1.jpg");
  });
  it("チェックリストの行の印を変える", () => {
    expect(setTaskLine("- [ ] a\n- [ ] b\n", "b", { done: true })).toBe("- [ ] a\n- [x] b\n");
  });
});
