import { Annotation, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

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
  EditorView.decorations.compute([replyRangeField], state => {
    const range = state.field(replyRangeField);
    if (!range || range.damaged) return Decoration.none;
    const lines = [];
    let line = state.doc.lineAt(range.bodyFrom);
    while (line.from <= range.bodyTo) {
      lines.push(Decoration.line({ attributes: { class: range.ink ? "riddle-diary-writing riddle-diary-ink" : "riddle-diary-writing" } }).range(line.from));
      if (line.number === state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
    return Decoration.set(lines);
  })
];

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
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly view: EditorView, offset: number, label: string, ink: boolean) {
    const header = `\n\n---\n**${label}**\n\n`;
    const body = `${STATUS_MARKER}*the ink is settling...*`;
    const block = `${header}${body}\n\n---\n\n`;
    view.dispatch({
      changes: { from: offset, insert: block },
      selection: { anchor: offset + block.length },
      effects: setReplyRange.of({
        from: offset + 2, to: offset + block.length - 2,
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
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = undefined;
      this.replace(`${STATUS_MARKER}${safeReplyMarkdown(this.text)}`);
    }, 40);
  }

  finish(status?: string): void {
    if (this.finished) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.intact) {
      let body: string;
      if (status) body = `${STATUS_MARKER}${this.text ? `${safeReplyMarkdown(this.text)}\n\n` : ""}*${status}*`;
      else if (this.text.trim()) body = safeReplyMarkdown(this.text);
      else body = `${STATUS_MARKER}*The diary returned no text. Check the model and token limit.*`;
      this.replace(body);
    }
    this.finished = true;
    // Never repair or overwrite a reply that the user edited/deleted themselves.
    this.view.dispatch({ effects: setReplyRange.of(null), annotations: diaryEdit.of(true) });
  }

  stopWithoutEditing(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.finished = true;
  }

  private replace(body: string): void {
    if (!this.intact) return;
    const range = this.view.state.field(replyRangeField)!;
    this.view.dispatch({ changes: { from: range.bodyFrom, to: range.bodyTo, insert: body }, annotations: diaryEdit.of(true) });
  }
}
