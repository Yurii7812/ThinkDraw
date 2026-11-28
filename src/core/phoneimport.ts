// スマホ(BRESUTO のスマホ用アプリ)の受信箱を、BRESUTO に取り込む(2026-11-28 利用者。質問票 br-1128c)。
// - メモ帳(memo)・日記と時系列記録(diary) → その日のグループの記録ノート(種類ごとに 1 枚)の本文に、時刻つきで足す
// - ノート(note。子・横つき) → ホームにノートとして置き、子は親から、横は親の親から線を引く
// - タスク(task / taskdone) → ホームのチェックリスト「スマホのタスク」に足す・済みにする(繰り返しは期限を進める)
// - 写真(file) → その日のグループに添付
// - 紙のカード(paper) → 紙PKM の取り込みへ(画像から ID を読む)
// - 種類(kinds) → 時系列記録の種類に足す
// 画面にも Electron にも依存しない(何をするかを決めて、host に頼む)
export interface PhoneFile {
  name: string;
  data: Uint8Array;
}
export interface PhoneState {
  /** 取り込んだ受信箱のファイルの名前と、そのときの updated(直したノートは取り込み直す) */
  seen: Record<string, string>;
  /** スマホのノートの名前 → BRESUTO のノート ID */
  notes: Record<string, string>;
  /** スマホのタスクの id → チェックリストの 1 行(今の文) */
  tasks: Record<string, { text: string; repeat: string }>;
  /** チェックリスト「スマホのタスク」のノート ID */
  taskNote?: string;
}
export const emptyPhoneState = (): PhoneState => ({ seen: {}, notes: {}, tasks: {} });

export interface PhoneHost {
  /** その日の記録ノート(種類ごとに 1 枚)の ID。無ければ作る */
  recordNote(ymd: string, kind: string): string;
  appendBody(id: string, text: string): void;
  /** ホームにノートを置く(親があれば、その近く)。ID を返す */
  placeNote(title: string, body: string, near: string | null): string;
  updateNote(id: string, title: string, body: string): void;
  link(from: string, to: string): void;
  parentOf(id: string): string | null;
  exists(id: string): boolean;
  /** ホームのチェックリスト(なければ作る)。ID を返す */
  taskNote(existing: string | undefined): string;
  getBody(id: string): string;
  setBody(id: string, body: string): void;
  attachToDay(ymd: string, name: string, data: Uint8Array): Promise<void>;
  addKinds(kinds: string[]): void;
}

const dec = new TextDecoder();
const dateOf = (at: unknown) => String(at ?? "").slice(0, 10);
const timeOf = (at: unknown) => String(at ?? "").slice(11, 16);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const firstLine = (t: string) => (t.split("\n").find((x) => x.trim()) ?? "").replace(/^#+\s*/, "").trim().slice(0, 60);
const REP: Record<string, string> = { daily: "毎日", weekly: "毎週", monthly: "毎月" };
const taskLabel = (t: { text: string; due?: string; repeat?: string }) =>
  [t.text.replace(/\s+/g, " ").trim(), t.due ? `📅${t.due}` : "", t.repeat && REP[t.repeat] ? `🔁${REP[t.repeat]}` : ""].filter(Boolean).join(" ");
const addMonth = (d: string) => {
  const t = new Date(d + "T12:00:00");
  t.setMonth(t.getMonth() + 1);
  return t.toISOString().slice(0, 10);
};
const addDays = (d: string, n: number) => {
  const t = new Date(d + "T12:00:00");
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
export const nextDue = (due: string, rep: string) => (rep === "daily" ? addDays(due, 1) : rep === "weekly" ? addDays(due, 7) : rep === "monthly" ? addMonth(due) : due);

/** チェックリストの本文で、label の行の印を変える・文を変える。見つからなければ足す */
export function setTaskLine(body: string, label: string, o: { done?: boolean; newLabel?: string }): string {
  const lines = body.replace(/\n+$/, "").split("\n").filter((l, i, a) => l.trim() || i < a.length - 1);
  const k = lines.findIndex((l) => /^\s*[-*+] \[[ xX]\] /.test(l) && l.replace(/^\s*[-*+] \[[ xX]\] /, "") === label);
  const mark = (d: boolean) => `- [${d ? "x" : " "}] `;
  if (k < 0) lines.push(mark(!!o.done) + (o.newLabel ?? label));
  else {
    const wasDone = /\[[xX]\]/.test(lines[k]);
    lines[k] = mark(o.done ?? wasDone) + (o.newLabel ?? label);
  }
  return lines.filter((l) => l.trim()).join("\n") + "\n";
}
/** PC で済みにしたタスク(繰り返しでないもの)の、スマホの id */
export function doneTaskIds(body: string, st: PhoneState): string[] {
  const done = new Set(body.split("\n").filter((l) => /^\s*[-*+] \[[xX]\] /.test(l)).map((l) => l.replace(/^\s*[-*+] \[[xX]\] /, "")));
  return Object.entries(st.tasks)
    .filter(([, t]) => !t.repeat && done.has(t.text))
    .map(([id]) => id);
}

export interface ImportResult {
  names: string[];
  counts: Record<string, number>;
  papers: PhoneFile[];
  skipped: string[];
}

/** 受信箱のファイルを取り込む。state は書き換える(呼んだ側が保存する) */
export async function importPhone(files: PhoneFile[], st: PhoneState, host: PhoneHost): Promise<ImportResult> {
  const by = new Map(files.map((f) => [f.name, f]));
  const res: ImportResult = { names: [], counts: {}, papers: [], skipped: [] };
  const count = (k: string) => (res.counts[k] = (res.counts[k] ?? 0) + 1);
  // 名前に時刻が入っているので、書いた順。ノートは親を先に
  const json = files
    .filter((f) => /\.json$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => {
      try {
        return { f, d: JSON.parse(dec.decode(f.data)) as Record<string, unknown> };
      } catch {
        res.skipped.push(f.name);
        return null;
      }
    })
    .filter((x): x is { f: PhoneFile; d: Record<string, unknown> } => !!x && !!x.d?.type);
  const notes = json.filter((x) => x.d.type === "note");
  const others = json.filter((x) => x.d.type !== "note");
  // ---- ノート(親を先に。直したノートは取り込み直す)
  const pending = [...notes];
  for (let guard = 0; pending.length && guard < 1000; guard++) {
    const k = pending.findIndex((x) => !x.d.parentName || !pending.some((y) => y.f.name === x.d.parentName));
    const { f, d } = pending.splice(k < 0 ? 0 : k, 1)[0];
    const updated = String(d.updated ?? d.created ?? "");
    const body = String(d.body ?? "");
    const title = firstLine(body) || "(無題)";
    const old = st.notes[f.name];
    if (old && host.exists(old)) {
      if (st.seen[f.name] !== updated) host.updateNote(old, title, body);
      st.seen[f.name] = updated;
      res.names.push(f.name);
      continue;
    }
    const parentNode = d.parentName ? st.notes[String(d.parentName)] : undefined;
    const from = parentNode && host.exists(parentNode) ? (d.rel === "sibling" ? host.parentOf(parentNode) : parentNode) : null;
    const id = host.placeNote(title, body, parentNode && host.exists(parentNode) ? parentNode : null);
    if (from) host.link(from, id);
    st.notes[f.name] = id;
    st.seen[f.name] = updated;
    res.names.push(f.name);
    count("note");
  }
  // ---- そのほか
  for (const { f, d } of others) {
    if (st.seen[f.name] !== undefined) {
      res.names.push(f.name);
      continue;
    }
    const t = d.type;
    let done = true;
    if (t === "memo") {
      const ymd = dateOf(d.at);
      if (!isDate(ymd)) done = false;
      else {
        host.appendBody(host.recordNote(ymd, "メモ"), `${timeOf(d.at)} ${String(d.text ?? "")}`.trim());
        count("memo");
      }
    } else if (t === "diary") {
      const ymd = isDate(String(d.date ?? "")) ? String(d.date) : dateOf(d.at);
      if (!isDate(ymd)) done = false;
      else {
        host.appendBody(host.recordNote(ymd, String(d.kind || "日記")), `${timeOf(d.at)} ${String(d.text ?? "")}`.trim());
        count("diary");
      }
    } else if (t === "task") {
      const id = String(d.id ?? f.name);
      const label = taskLabel({ text: String(d.text ?? ""), due: String(d.due ?? ""), repeat: String(d.repeat ?? "") });
      st.taskNote = host.taskNote(st.taskNote);
      host.setBody(st.taskNote, setTaskLine(host.getBody(st.taskNote), label, { done: false }));
      st.tasks[id] = { text: label, repeat: String(d.repeat ?? "") };
      count("task");
    } else if (t === "taskdone") {
      const id = String(d.id ?? "");
      const task = st.tasks[id];
      if (!task || !st.taskNote) done = false; // タスクがまだ来ていない(次の取り込みで)
      else {
        const src = others.find((x) => x.d.type === "task" && String(x.d.id) === id)?.d;
        if (task.repeat && d.due) {
          const due = nextDue(String(d.due), task.repeat);
          const text = String(src?.text ?? task.text.replace(/ 📅\S+| 🔁\S+/g, ""));
          const label = taskLabel({ text, due, repeat: task.repeat });
          host.setBody(st.taskNote, setTaskLine(host.getBody(st.taskNote), task.text, { done: false, newLabel: label }));
          task.text = label;
        } else host.setBody(st.taskNote, setTaskLine(host.getBody(st.taskNote), task.text, { done: true }));
        count("taskdone");
      }
    } else if (t === "file") {
      const file = String(d.file ?? "");
      const bin = by.get(file);
      const ymd = dateOf(d.at);
      if (!bin || !isDate(ymd)) done = false;
      else {
        await host.attachToDay(ymd, String(d.name || file), bin.data);
        res.names.push(file);
        count("file");
      }
    } else if (t === "paper" || t === "pmemo") {
      const img = by.get(String(d.image ?? ""));
      if (!img) done = false;
      else {
        res.papers.push(img);
        res.names.push(img.name);
        count("paper");
      }
    } else if (t === "kinds") {
      host.addKinds(((d.kinds as unknown[]) ?? []).map(String).filter(Boolean));
    } else if (t === "mark" || t === "audio") {
      /* 使わない(取り込み済みにだけする) */
    } else done = false;
    if (done) {
      st.seen[f.name] = "1";
      res.names.push(f.name);
    }
  }
  return res;
}
