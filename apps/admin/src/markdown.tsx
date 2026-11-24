import type { ReactNode } from "react";

// A small reader for the admin guide, which is written in plain markdown so the same file
// is the printable guide and the Help page. It handles only what the guide uses, and builds
// React elements (never raw HTML), so nothing in it can inject markup.

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)!;
      out.push(
        <a key={key} href={href} {...(/^https?:/.test(href!) ? { target: "_blank", rel: "noreferrer" } : {})}>
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type GuideSection = { id: string; title: string; body: ReactNode[] };

// Splits the guide at its "## " headings and renders each section's body.
export function parseGuide(markdown: string): { title: string; intro: ReactNode[]; sections: GuideSection[] } {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let title = "";
  const introLines: string[] = [];
  const sections: { id: string; title: string; lines: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith("# ") && !title) title = line.slice(2).trim();
    else if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      sections.push({ id: slug(heading.replace(/^\d+\.\s*/, "")), title: heading, lines: [] });
    } else (sections.length ? sections[sections.length - 1]!.lines : introLines).push(line);
  }
  return {
    title,
    intro: blocks(introLines, "intro"),
    sections: sections.map((section) => ({ id: section.id, title: section.title, body: blocks(section.lines, section.id) })),
  };
}

function blocks(lines: string[], prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const next = () => `${prefix}-${key++}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("### ")) {
      out.push(<h3 key={next()}>{inline(line.slice(4), `${prefix}h`)}</h3>);
      i++;
    } else if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) quote.push(lines[i++]!.slice(2));
      out.push(
        <aside key={next()} className="guide-callout">
          {inline(quote.join(" "), `${prefix}q`)}
        </aside>,
      );
    } else if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^-+$/.test(cell))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={next()} className="guide-table">
          <table>
            <thead>
              <tr>{head!.map((cell, c) => <th key={c}>{inline(cell, `${prefix}th${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c} data-label={head![c]}>{inline(cell, `${prefix}td${r}${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { text: string; nested: string[] }[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s/.test(lines[i]!) || /^\s{2,}\S/.test(lines[i]!))) {
        const current = lines[i]!;
        if (/^\s{2,}[-*]\s/.test(current) && items.length) items[items.length - 1]!.nested.push(current.trim().replace(/^[-*]\s/, ""));
        else if (/^\s{2,}\S/.test(current) && items.length) items[items.length - 1]!.text += ` ${current.trim()}`;
        else items.push({ text: current.replace(/^\s*([-*]|\d+\.)\s/, ""), nested: [] });
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={next()}>
          {items.map((item, n) => (
            <li key={n}>
              {inline(item.text, `${prefix}li${n}`)}
              {item.nested.length ? <ul>{item.nested.map((sub, s) => <li key={s}>{inline(sub, `${prefix}n${n}${s}`)}</li>)}</ul> : null}
            </li>
          ))}
        </List>,
      );
    } else {
      const paragraph: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#|>|\||\s*([-*]|\d+\.)\s)/.test(lines[i]!)) paragraph.push(lines[i++]!);
      out.push(<p key={next()}>{inline(paragraph.join(" "), `${prefix}p`)}</p>);
    }
  }
  return out;
}
