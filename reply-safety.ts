function literalMarkup(text: string): string {
  // One escape regardless of existing backslashes: two would reactivate a link.
  return text.replace(/\\*([\[\]])/g, "\\$1").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Keep actual inline code literal; unmatched/multiline spans remain conservative. */
function safeInline(text: string): string {
  const ticks = [...text.matchAll(/`+/g)];
  const next: (number | undefined)[] = [];
  const byLength = new Map<number, number>();
  for (let i = ticks.length - 1; i >= 0; i--) {
    const length = ticks[i]![0].length;
    next[i] = byLength.get(length);
    byLength.set(length, i);
  }
  let result = "";
  let from = 0;
  for (let i = 0; i < ticks.length; i++) {
    const opening = ticks[i]!;
    const at = opening.index!;
    let before = at;
    while (before > 0 && text[before - 1] === "\\") before--;
    if ((at - before) % 2 !== 0) continue;
    const end = next[i];
    if (end === undefined) continue;
    const to = ticks[end]!.index! + ticks[end]![0].length;
    result += literalMarkup(text.slice(from, at)) + text.slice(at, to);
    from = to;
    i = end;
  }
  return result + literalMarkup(text.slice(from));
}

/** Model links, images, vault embeds and HTML are shown as text, never activated. */
export function safeReplyMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^---\s*$/gm, "***").split("\n");
  let fence: { char: string; length: number } | undefined;
  const safe = lines.map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1]![0] === fence.char && marker[1]!.length >= fence.length && /^\s*$/.test(marker[2]!)) fence = undefined;
      return line;
    }
    if (marker && (marker[1]![0] !== "`" || !marker[2]!.includes("`"))) {
      fence = { char: marker[1]![0]!, length: marker[1]!.length };
      return literalMarkup(line);
    }
    return safeInline(line);
  });
  const result = safe.join("\n");
  return fence ? `${result}\n${fence.char.repeat(fence.length)}` : result;
}
