// 本文の中のノードへのリンク [文章](<ID>.md) を拾う(SPEC 3.4)

const BODY_LINK_RE = /\]\(\s*<?(?:\.\/)?([a-z0-9]{10}|root)\.md>?(?:\s+"[^"]*")?\s*\)/g;

export function bodyLinkTargets(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(BODY_LINK_RE)) out.add(m[1]);
  return [...out];
}

/** 本文にリンク先の URL だけが書かれた行(リンクカードにする行)の URL を返す */
export function urlOnlyLines(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    const m = t.match(/^<?(https?:\/\/[^\s<>]+)>?$/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function nodeHref(id: string): string {
  return `${id}.md`;
}

export function hrefToNodeId(href: string): string | null {
  const m = href.trim().match(/^(?:\.\/)?([a-z0-9]{10}|root)\.md$/);
  return m ? m[1] : null;
}
