import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { Transaction, type Extension } from "@codemirror/state";
import { frontmatterEnd, insideAnswer, insideCodeFence } from "./context";
import { diaryEdit } from "./writer";

export interface TriggerMatch {
  flagFrom: number;
  flagTo: number;
  insertion: number;
}

export function matchTrigger(transaction: Transaction, flag: string): TriggerMatch | null {
  if (!flag || /\s/.test(flag) || transaction.annotation(diaryEdit) || !transaction.docChanged) return null;
  const event = transaction.annotation(Transaction.userEvent);
  // Enter on desktop and mobile. Paste, drop, completion, undo, and our edits never qualify.
  if (event !== "input" && event !== "input.type") return null;
  if (transaction.startState.selection.ranges.length !== 1 || !transaction.startState.selection.main.empty) return null;
  const cursor = transaction.startState.selection.main.head;
  const line = transaction.startState.doc.lineAt(cursor);
  if (cursor !== line.to || !line.text.endsWith(flag)) return null;
  let count = 0;
  let newline = false;
  transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    count++;
    newline = from === cursor && to === cursor && /^\n[\t ]*$/.test(inserted.toString());
  });
  if (count !== 1 || !newline) return null;
  const text = transaction.startState.doc.toString();
  if (cursor < frontmatterEnd(text) || insideAnswer(text, cursor) || insideCodeFence(text, cursor)) return null;
  return { flagFrom: cursor - flag.length, flagTo: cursor, insertion: transaction.changes.mapPos(cursor, 1) };
}

export function triggerExtension(
  getFlag: () => string,
  onTrigger: (view: EditorView, match: TriggerMatch) => void,
  onUpdate: (view: EditorView) => void,
  onDestroy: (view: EditorView) => void
): Extension {
  return ViewPlugin.fromClass(class {
    constructor(private readonly view: EditorView) {}
    update(update: ViewUpdate): void {
      onUpdate(update.view);
      for (const transaction of update.transactions) {
        const match = matchTrigger(transaction, getFlag());
        if (!match) continue;
        const expectedDoc = update.view.state.doc;
        // Dispatching during a CodeMirror update is forbidden. Run after the update.
        queueMicrotask(() => {
          if (update.view.state.doc === expectedDoc) onTrigger(update.view, match);
        });
        break;
      }
    }
    destroy(): void { onDestroy(this.view); }
  });
}
