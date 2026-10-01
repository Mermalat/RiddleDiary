import { Annotation, findClusterBreak, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";

export const diaryEdit = Annotation.define<boolean>();
export const STATUS_MARKER = "<!-- riddle-diary:status -->\n";

export interface ReplyRange {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  damaged: boolean;
  ink: boolean;
}

const setReplyRange = StateEffect.define<ReplyRange | null>();
const freshInk = StateEffect.define<{ from: number; to: number }>();
const clearInk = StateEffect.define<null>();
let inkBatch = 0;

export const inkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(clearInk)) value = Decoration.none;
      if (effect.is(freshInk) && effect.value.from < effect.value.to) {
        value = value.update({ add: [Decoration.mark({
          class: "riddle-diary-ink",
          attributes: { "data-ink-batch": String(++inkBatch) }
        }).range(effect.value.from, effect.value.to)] });
      }
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});

// Keep each fresh span alive long enough to finish its animation, including the
// final characters. Editing the old text does not restart its animation.
const inkCleanup = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly view: EditorView) {}
  update(update: import("@codemirror/view").ViewUpdate): void {
    if (!update.transactions.some(transaction => transaction.effects.some(effect => effect.is(freshInk)))) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.view.dispatch({ effects: clearInk.of(null), annotations: diaryEdit.of(true) });
    }, 850);
  }
  destroy(): void { if (this.timer) clearTimeout(this.timer); }
});

function hideStatusComments(state: EditorState): DecorationSet {
  const decorations = [];
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (line.text === STATUS_MARKER.trim()) decorations.push(Decoration.replace({}).range(line.from, line.to));
  }
  return Decoration.set(decorations);
}

const statusCommentsField = StateField.define<DecorationSet>({
  create: hideStatusComments,
  update: (value, transaction) => transaction.docChanged ? hideStatusComments(transaction.state) : value,
  provide: field => EditorView.decorations.from(field)
});

export const replyRangeField = StateField.define<ReplyRange | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      let damaged = value.damaged;
      if (!transaction.annotation(diaryEdit)) {
        transaction.changes.iterChangedRanges((from, to) => {
          if (from === to ? from > value!.from && from < value!.to : from < value!.to && to > value!.from) damaged = true;
        });
      }
      value = {
        ...value, damaged,
        from: transaction.changes.mapPos(value.from, 1),
        to: transaction.changes.mapPos(value.to, -1),
        bodyFrom: transaction.changes.mapPos(value.bodyFrom, -1),
        bodyTo: transaction.changes.mapPos(value.bodyTo, 1)
      };
    }
    for (const effect of transaction.effects) if (effect.is(setReplyRange)) value = effect.value;
    return value;
  }
});

export const writerExtension: Extension = [
  statusCommentsField,
  replyRangeField,
  inkField,
  inkCleanup,
  EditorView.decorations.compute([replyRangeField], state => {
    const range = state.field(replyRangeField);
    if (!range || range.damaged) return Decoration.none;
    const lines = [];
    let line = state.doc.lineAt(range.bodyFrom);
    while (line.from <= range.bodyTo) {
      if (line.text !== STATUS_MARKER.trim()) lines.push(Decoration.line({ attributes: { class: "riddle-diary-writing" } }).range(line.from));
      if (line.number === state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
    return Decoration.set(lines);
  })
];

/** Emphasize plain entry lines while preserving existing Markdown structures. */
export function boldQuestion(text: string): string {
  const content = text.trim();
  if (!content || /^\s/.test(text) || /^(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`|~{3}|\||<|\$)/.test(content) || /^(?:[-*_]\s*){3,}$/.test(content) || /\*\*|__|\\$/.test(content)) return text;
  return `**${content}**${text.slice(content.length)}`;
}

/** Keep provider Markdown from accidentally closing our outer answer block. */
export function safeReplyMarkdown(text: string): string {
  text = text.replace(/\r\n?/g, "\n").replace(/^---\s*$/gm, "***");
  let fence: { char: string; length: number } | undefined;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!marker) continue;
    if (!fence) fence = { char: marker[1]![0]!, length: marker[1]!.length };
    else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = undefined;
  }
  return fence ? `${text}\n${fence.char.repeat(fence.length)}` : text;
}

/** Edits only the tracked body; CodeMirror maps the user's selections naturally. */
export class ReplyWriter {
  private text = "";
  private revealed = 0;
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drained: (() => void) | undefined;

  constructor(readonly view: EditorView, offset: number, label: string, private readonly ink: boolean) {
    // An Enter-trigger already supplies one newline. Normalize the surrounding
    // spacing rather than accumulating a third blank line on every exchange.
    const before = view.state.doc.sliceString(0, offset);
    const after = view.state.doc.sliceString(offset);
    const prefix = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const suffix = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const header = `${prefix}---\n**${label}**\n\n`;
    const body = `${STATUS_MARKER}*the ink is settling...*`;
    const block = `${header}${body}\n\n---${suffix}`;
    view.dispatch({
      changes: { from: offset, insert: block },
      selection: { anchor: offset + block.length + (2 - suffix.length) },
      effects: setReplyRange.of({
        from: offset + prefix.length, to: offset + block.length - suffix.length,
        bodyFrom: offset + header.length, bodyTo: offset + header.length + body.length,
        damaged: false, ink
      }),
      annotations: diaryEdit.of(true)
    });
  }

  get intact(): boolean {
    const range = this.view.state.field(replyRangeField, false);
    return !!range && !range.damaged && !this.finished;
  }

  append(chunk: string): void {
    if (!this.intact) return;
    this.text += chunk;
    this.schedule();
  }

  /** Wait for received CLI/API text to finish its visual reveal. Cancellation releases this wait. */
  async drain(): Promise<void> {
    if (!this.intact || this.revealed === this.text.length) return;
    await new Promise<void>(resolve => { this.drained = resolve; });
  }

  private schedule(): void {
    if (this.timer || !this.intact) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.intact) { this.releaseDrain(); return; }
      if (this.ink) {
        // Adaptive pacing keeps large completed CLI messages from taking minutes.
        const count = Math.max(2, Math.ceil((this.text.length - this.revealed) / 120));
        for (let i = 0; i < count && this.revealed < this.text.length; i++) this.revealed = findClusterBreak(this.text, this.revealed, true);
      } else this.revealed = this.text.length;
      this.replace(`${STATUS_MARKER}${safeReplyMarkdown(this.text.slice(0, this.revealed))}`, this.ink);
      if (this.revealed < this.text.length) this.schedule();
      else this.releaseDrain();
    }, this.ink ? 24 : 40);
  }

  private releaseDrain(): void {
    this.drained?.();
    this.drained = undefined;
  }

  finish(status?: string): void {
    if (this.finished) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.intact) {
      let body: string;
      const visible = this.ink ? this.text.slice(0, this.revealed) : this.text;
      if (status) body = `${STATUS_MARKER}${visible ? `${safeReplyMarkdown(visible)}\n\n` : ""}*${status}*`;
      else if (this.text.trim()) body = safeReplyMarkdown(this.text);
      else body = `${STATUS_MARKER}*The diary returned no text. Check the model and token limit.*`;
      this.replace(body);
    }
    this.finished = true;
    this.releaseDrain();
    // Never repair or overwrite a reply that the user edited/deleted themselves.
    this.view.dispatch({ effects: setReplyRange.of(null), annotations: diaryEdit.of(true) });
  }

  stopWithoutEditing(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.finished = true;
    this.releaseDrain();
  }

  private replace(body: string, animate = false): void {
    if (!this.intact) return;
    const range = this.view.state.field(replyRangeField)!;
    const previous = this.view.state.doc.sliceString(range.bodyFrom, range.bodyTo);
    let shared = 0;
    while (shared < previous.length && shared < body.length && previous[shared] === body[shared]) shared++;
    let suffix = 0;
    while (suffix < previous.length - shared && suffix < body.length - shared && previous[previous.length - 1 - suffix] === body[body.length - 1 - suffix]) suffix++;
    // Incremental edits preserve old spans, selections and settled ink.
    const from = range.bodyFrom + shared;
    const insert = body.slice(shared, body.length - suffix);
    const inkFrom = Math.max(from, range.bodyFrom + (body.startsWith(STATUS_MARKER) ? STATUS_MARKER.length : 0));
    this.view.dispatch({
      changes: { from, to: range.bodyTo - suffix, insert },
      effects: animate && inkFrom < from + insert.length ? freshInk.of({ from: inkFrom, to: from + insert.length }) : [],
      annotations: diaryEdit.of(true)
    });
  }
}
