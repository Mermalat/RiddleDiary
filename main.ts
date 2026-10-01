import { MarkdownView, Notice, Plugin, type Editor, type TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { buildMessages, frontmatterEnd, insideAnswer, insideCodeFence } from "./context";
import { createProvider } from "./providers";
import { DiaryError } from "./providers/provider";
import { DiarySettingTab, diaryIdentity, loadSettings } from "./settings";
import { triggerExtension, type TriggerMatch } from "./trigger";
import type { DiarySettings } from "./types";
import { boldQuestion, diaryEdit, ReplyWriter, writerExtension } from "./writer";

interface ActiveReply {
  file: TFile;
  controller: AbortController;
  writer: ReplyWriter;
  timeout: ReturnType<typeof setTimeout>;
}

// Obsidian documents this bridge for commands communicating with CM6 extensions.
function editorView(editor: Editor): EditorView | null {
  // @ts-expect-error Obsidian's public Editor type omits its CodeMirror bridge.
  const view = editor.cm as EditorView | undefined;
  return view?.state ? view : null;
}

export default class RiddleDiaryPlugin extends Plugin {
  settings: DiarySettings = loadSettings(null);
  private readonly active = new Map<TFile, ActiveReply>();

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData() as Partial<DiarySettings> | null);
    this.addSettingTab(new DiarySettingTab(this.app, this));
    this.registerEditorExtension([
      writerExtension,
      triggerExtension(
        () => this.settings.triggerFlag,
        (view, match) => { void this.reply(view, match); },
        view => {
          const active = this.forEditor(view);
          if (active && !active.writer.intact) queueMicrotask(() => this.cancel(active, "Reply stopped because its block was edited."));
        },
        view => {
          const active = this.forEditor(view);
          if (active) {
            // The closed status-marked block remains safe if its editor is destroyed.
            active.controller.abort();
            active.writer.stopWithoutEditing();
            clearTimeout(active.timeout);
            this.active.delete(active.file);
          }
        }
      ),
      Prec.highest(EditorView.domEventHandlers({ keydown: (event, view) => {
        if (event.key !== "Escape") return false;
        const active = this.forEditor(view);
        if (!active) return false;
        this.cancel(active, "Reply cancelled.");
        event.preventDefault();
        return true;
      } }))
    ]);
    // Obsidian can consume Escape before CM6. Capture only events from a replying
    // editor, leaving settings, command palettes, and other notes' Escape alone.
    this.registerDomEvent(document, "keydown", event => {
      if (event.key !== "Escape" || !(event.target instanceof Node)) return;
      const active = [...this.active.values()].find(reply => reply.writer.view.dom.contains(event.target as Node));
      if (!active) return;
      this.cancel(active, "Reply cancelled.");
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true });
    this.addCommand({
      id: "reply-now", name: "Diary: reply now",
      editorCallback: editor => {
        const view = editorView(editor);
        if (view) void this.reply(view);
        else new Notice("Open a Markdown note in editing mode first.");
      }
    });
    this.addCommand({
      id: "preview-ink", name: "Diary: preview ink (offline)",
      editorCallback: editor => {
        const view = editorView(editor);
        if (view) void this.reply(view, undefined, true);
      }
    });
    this.addCommand({
      id: "cancel-reply", name: "Diary: cancel reply",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        const active = file ? this.active.get(file) : undefined;
        if (!active) return false;
        if (!checking) this.cancel(active, "Reply cancelled.");
        return true;
      }
    });
  }

  onunload(): void {
    for (const active of this.active.values()) this.cancel(active, "Reply cancelled: diary plugin unloaded.");
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  private forEditor(view: EditorView): ActiveReply | undefined {
    return [...this.active.values()].find(reply => reply.writer.view === view);
  }

  private noteForEditor(view: EditorView): MarkdownView | undefined {
    let result: MarkdownView | undefined;
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView && editorView(leaf.view.editor) === view) result = leaf.view;
    });
    return result;
  }

  private cancel(active: ActiveReply, status: string): void {
    if (this.active.get(active.file) !== active) return;
    active.controller.abort();
    clearTimeout(active.timeout);
    active.writer.finish(status);
    this.active.delete(active.file);
  }

  private async reply(view: EditorView, trigger?: TriggerMatch, preview = false): Promise<void> {
    const note = this.noteForEditor(view);
    const file = note?.file;
    if (!file) { new Notice("Open a saved Markdown note in editing mode first."); return; }
    if (this.active.has(file)) { new Notice("The diary is already replying to this note. Press Escape to cancel."); return; }
    if (view.state.selection.ranges.length !== 1) { new Notice("Use a single cursor for a diary reply."); return; }
    let cursor = view.state.selection.main.head;
    const text = view.state.doc.toString();
    if (cursor < frontmatterEnd(text) || insideAnswer(text, trigger?.flagFrom ?? cursor) || insideCodeFence(text, cursor)) {
      new Notice("Write outside frontmatter, code fences, and diary answer blocks.");
      return;
    }
    if (trigger) {
      view.dispatch({ changes: { from: trigger.flagFrom, to: trigger.flagTo }, annotations: diaryEdit.of(true) });
      cursor = trigger.insertion - (trigger.flagTo - trigger.flagFrom);
    } else {
      // Commands write after the entire current line, leaving its contents intact.
      cursor = view.state.doc.lineAt(cursor).to;
    }
    const messages = buildMessages(view.state.doc.toString(), this.settings.contextMode, cursor);
    if (!messages.some(message => message.role === "user")) { new Notice("Write something to the diary first."); return; }
    const question = view.state.doc.lineAt(trigger ? trigger.flagFrom : cursor);
    const formatted = boldQuestion(question.text);
    if (formatted !== question.text) {
      const changes = view.state.changes({ from: question.from, to: question.to, insert: formatted });
      cursor = changes.mapPos(cursor, 1);
      view.dispatch({ changes, annotations: diaryEdit.of(true) });
    }
    const provider = createProvider(this.settings);
    const { label, systemPrompt } = diaryIdentity(this.settings);
    const controller = new AbortController();
    const ink = this.settings.inkEffect && !view.dom.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const writer = new ReplyWriter(view, cursor, label, ink);
    const active: ActiveReply = {
      file, controller, writer,
      timeout: setTimeout(() => this.cancel(active, "Reply timed out. Try again when the provider is available."), 120000)
    };
    this.active.set(file, active);
    try {
      const stream = preview ? this.previewInk(controller.signal) : provider.streamReply(messages, systemPrompt, controller.signal);
      for await (const chunk of stream) {
        if (controller.signal.aborted || this.active.get(file) !== active) break;
        if (this.noteForEditor(view)?.file !== file || !writer.intact) {
          this.cancel(active, "Reply stopped because the note changed.");
          break;
        }
        writer.append(chunk);
      }
      await writer.drain();
      if (this.active.get(file) === active) writer.finish(preview ? "Offline preview — no API request was sent." : undefined);
    } catch (error) {
      if (this.active.get(file) === active) {
        const message = controller.signal.aborted ? "Reply cancelled." : error instanceof DiaryError ? error.message : "The diary could not finish its reply. Check your connection and settings.";
        writer.finish(message);
        if (!controller.signal.aborted) new Notice(`Riddle Diary: ${message}`);
      }
    } finally {
      clearTimeout(active.timeout);
      if (this.active.get(file) === active) this.active.delete(file);
    }
  }

  private async *previewInk(signal: AbortSignal): AsyncGenerator<string> {
    const text = "I have been waiting between these quiet lines. Write what troubles you, or what delights you; there is room on this page for both.";
    for (const word of text.split(" ")) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 110);
        signal.addEventListener("abort", cancel, { once: true });
      });
      yield `${word} `;
    }
  }
}
