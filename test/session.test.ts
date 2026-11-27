import { describe, expect, it } from "vitest";
import { applyOps, emptyBoard, SessionSync, type Op } from "../src/core/session";
import { ROOT_ID } from "../src/core/types";
import { Vault } from "../src/core/vault";

const memIO = { write: async () => {}, trash: async () => {} };
function room() {
  const state = emptyBoard("会議");
  const peers: SessionSync[] = [];
  const join = () => {
    const v = new Vault(memIO);
    v.load([]);
    let me: SessionSync;
    const send = (ops: Op[]) => {
      applyOps(state, ops);
      for (const p of peers) if (p !== me) p.receive(ops);
    };
    me = new SessionSync(v, send);
    me.load(JSON.parse(JSON.stringify(state)));
    peers.push(me);
    return v;
  };
  return { state, join };
}

describe("共有ボードの同期(2026-11-28)", () => {
  it("書いた物・線・位置が、ほかの人と、あとから入った人に届く", () => {
    const r = room();
    const a = r.join(), b = r.join();
    const x = a.create({ type: "text", title: "案1", group: ROOT_ID, x: 10, y: 20 });
    const y = a.create({ type: "text", title: "案2", group: ROOT_ID, x: 200, y: 20 });
    a.addLink(x.id, y.id);
    expect(b.get(x.id)?.title).toBe("案1");
    expect(b.get(x.id)?.links[0]?.to).toBe(y.id);
    expect(b.itemPos(ROOT_ID, y.id)).toMatchObject({ x: 200, y: 20 });
    const c = r.join();
    expect(c.get(y.id)?.title).toBe("案2");
    expect(c.root().title).toBe("会議");
  });
  it("別々の物を同時に動かしても、どちらの移動も残る", () => {
    const r = room();
    const a = r.join(), b = r.join();
    const x = a.create({ type: "text", title: "x", group: ROOT_ID, x: 0, y: 0 });
    const y = a.create({ type: "text", title: "y", group: ROOT_ID, x: 100, y: 0 });
    a.move(ROOT_ID, [{ id: x.id, x: 50, y: 50 }]);
    b.move(ROOT_ID, [{ id: y.id, x: 300, y: 300 }]);
    for (const v of [a, b]) {
      expect(v.itemPos(ROOT_ID, x.id)).toMatchObject({ x: 50, y: 50 });
      expect(v.itemPos(ROOT_ID, y.id)).toMatchObject({ x: 300, y: 300 });
    }
    expect(r.state.pos[x.id]).toMatchObject({ x: 50, y: 50 });
  });
  it("消すと、みんなから消える。届いた変更は送り返さない(元に戻すにも積まない)", () => {
    const r = room();
    const a = r.join(), b = r.join();
    const x = a.create({ type: "text", title: "消す", group: ROOT_ID, x: 0, y: 0 });
    expect(b.canUndo()).toBe(false);
    b.trash([x.id]);
    expect(a.get(x.id)).toBeUndefined();
    expect(r.state.nodes[x.id]).toBeUndefined();
  });
});

describe("書いた人", () => {
  it("手元で作った物にだけ、自分の印が付く(届いた物には付けない)", () => {
    const state = emptyBoard("b");
    const peers: SessionSync[] = [];
    const mk = (pid: string) => {
      const v = new Vault(memIO);
      v.load([]);
      let me: SessionSync;
      me = new SessionSync(v, (ops) => (applyOps(state, ops), peers.forEach((p) => p !== me && p.receive(ops))), (n) => {
        if (typeof n.extra.by !== "string") n.extra.by = pid;
      });
      peers.push(me);
      return v;
    };
    const a = mk("A"), b = mk("B");
    const x = a.create({ type: "text", title: "Aの案", group: ROOT_ID, x: 0, y: 0 });
    expect(a.get(x.id)?.extra.by).toBe("A");
    expect(b.get(x.id)?.extra.by).toBe("A");
    b.update(x.id, { color: 2 });
    expect(a.get(x.id)?.extra.by).toBe("A");
  });
});
