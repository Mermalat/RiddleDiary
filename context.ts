import type { Message } from "./types";

export interface AnswerBlock {
  from: number;
  to: number;
  content: string;
  complete: boolean;
}

interface Line {
  text: string;
  from: number;
  to: number;
}

function linesOf(text: string): Line[] {
  let from = 0;
  return text.split("\n").map(text => {
    const line = { text: text.replace(/\r$/, ""), from, to: from + text.length };
    from += text.length + 1;
    return line;
  });
}

export function frontmatterEnd(text: string): number {
  const lines = linesOf(text);
  if (lines[0]?.text.replace(/^\uFEFF/, "") !== "---") return 0;
  if (/^\*\*[^\n*]+ answers\*\*\s*$/.test(lines[1]?.text ?? "")) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i]!.text)) return Math.min(text.length, lines[i]!.to + 1);
  }
  // An unfinished properties section is still metadata, not conversation.
  return text.length + 1;
}

/** Recognize diary labels generically, including labels from future providers. */
export function answerBlocks(text: string): AnswerBlock[] {
  const lines = linesOf(text);
  const metadataEnd = frontmatterEnd(text);
  const blocks: AnswerBlock[] = [];
  let fence: { char: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.from < metadataEnd) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (marker) {
      if (!fence) fence = { char: marker[1]![0]!, length: marker[1]!.length };
      else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line.text)) fence = undefined;
      continue;
    }
    if (fence || !/^---\s*$/.test(line.text) || !/^\*\*[^\n*]+ answers\*\*\s*$/.test(lines[i + 1]?.text ?? "")) continue;
    const bodyFrom = Math.min(text.length, lines[i + 1]!.to + 1);
    let end = i + 2;
    let bodyFence: { char: string; length: number } | undefined;
    for (; end < lines.length; end++) {
      const bodyLine = lines[end]!.text;
      const bodyMarker = /^ {0,3}(`{3,}|~{3,})/.exec(bodyLine);
      if (bodyMarker) {
        if (!bodyFence) bodyFence = { char: bodyMarker[1]![0]!, length: bodyMarker[1]!.length };
        else if (bodyMarker[1]![0] === bodyFence.char && bodyMarker[1]!.length >= bodyFence.length && /^ {0,3}(`+|~+)\s*$/.test(bodyLine)) bodyFence = undefined;
      } else if (!bodyFence && /^---\s*$/.test(bodyLine)) break;
    }
    const complete = end < lines.length;
    blocks.push({
      from: line.from,
      to: complete ? lines[end]!.to : text.length,
      content: text.slice(bodyFrom, complete ? lines[end]!.from : text.length).trim(),
      complete
    });
    i = complete ? end : lines.length;
  }
  return blocks;
}

export function insideAnswer(text: string, offset: number): boolean {
  return answerBlocks(text).some(block => offset >= block.from && offset <= block.to);
}

export function insideCodeFence(text: string, offset: number): boolean {
  let fence: { char: string; length: number } | undefined;
  for (const line of linesOf(text.slice(0, offset))) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (!marker) continue;
    if (!fence) fence = { char: marker[1]![0]!, length: marker[1]!.length };
    else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line.text)) fence = undefined;
  }
  return !!fence;
}

export function buildMessages(text: string, mode: "full" | "above", cursor: number): Message[] {
  const source = mode === "above" ? text.slice(0, cursor) : text;
  const messages: Message[] = [];
  const add = (role: Message["role"], content: string) => {
    content = content.trim();
    if (!content) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  };
  let from = frontmatterEnd(source);
  for (const block of answerBlocks(source)) {
    add("user", source.slice(from, block.from));
    // Loading, failed, cancelled, and interrupted blocks are not model responses.
    if (block.complete && block.content && !block.content.startsWith("<!-- riddle-diary:status -->")) {
      add("assistant", block.content);
    }
    from = block.to;
  }
  add("user", source.slice(from));
  return messages;
}
