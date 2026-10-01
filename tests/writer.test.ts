import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { answerBlocks, buildMessages } from "../context";
import { ReplyWriter, replyRangeField, safeReplyMarkdown } from "../writer";

function harness(doc = "hello") {
  const mock = {
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [replyRangeField] }),
    dispatch(spec: TransactionSpec) { this.state = this.state.update(spec).state; }
  };
  return { mock, writer: new ReplyWriter(mock as unknown as EditorView, doc.length, "Claude answers", false) };
}

test("placeholder, success, error, and cancellation always have a closing rule", () => {
  for (const status of [undefined, "API error 401. Check your API key.", "Reply cancelled."]) {
    const { mock, writer } = harness();
    assert.ok(mock.state.doc.toString().includes("*the ink is settling...*"));
    assert.equal(answerBlocks(mock.state.doc.toString())[0]?.complete, true);
    writer.append("A quiet reply.");
    writer.finish(status);
    const text = mock.state.doc.toString();
    assert.equal(answerBlocks(text)[0]?.complete, true);
    assert.ok(text.includes("\n\n---\n\n"), "closing rule must not become a setext heading");
    assert.ok(!text.includes("settling"));
    assert.equal(buildMessages(text, "full", 0).some(turn => turn.role === "assistant"), status === undefined);
  }
});

test("outside edits and cursor position survive the stream", () => {
  const { mock, writer } = harness();
  mock.dispatch({ changes: { from: 0, insert: "before\n" } });
  const end = mock.state.doc.length;
  mock.dispatch({ changes: { from: end, insert: "I can keep typing." }, selection: { anchor: end + 18 } });
  writer.append("Answer line one.\nAnswer line two.");
  writer.finish();
  const text = mock.state.doc.toString();
  assert.ok(text.startsWith("before\nhello"));
  assert.ok(text.endsWith("I can keep typing."));
  assert.equal(mock.state.selection.main.head, text.length);
  assert.equal(answerBlocks(text)[0]?.content, "Answer line one.\nAnswer line two.");
});

test("editing the streamed block stops writes without overwriting the edit", () => {
  const { mock, writer } = harness();
  const range = mock.state.field(replyRangeField)!;
  mock.dispatch({ changes: { from: range.bodyFrom, to: range.bodyTo, insert: "my own edit" } });
  assert.equal(writer.intact, false);
  const expected = mock.state.doc.toString();
  writer.append("must not overwrite");
  writer.finish("Cancelled.");
  assert.equal(mock.state.doc.toString(), expected);
});

test("deleting the block is respected", () => {
  const { mock, writer } = harness();
  const range = mock.state.field(replyRangeField)!;
  mock.dispatch({ changes: { from: range.from, to: range.to } });
  writer.finish();
  assert.ok(!mock.state.doc.toString().includes("answers"));
});

test("provider horizontal rules and unfinished code cannot break the wrapper", () => {
  const { mock, writer } = harness();
  writer.append("part one\n---\npart two\n```ts\nconst x = 1;");
  writer.finish();
  assert.equal(answerBlocks(mock.state.doc.toString())[0]?.complete, true);
  assert.ok(mock.state.doc.toString().includes("***"));
  assert.equal(safeReplyMarkdown("plain text"), "plain text");
});

test("a cancelled reply with no streamed text clears the placeholder", () => {
  const { mock, writer } = harness();
  writer.finish("Reply cancelled.");
  assert.ok(mock.state.doc.toString().includes("Reply cancelled."));
  assert.ok(!mock.state.doc.toString().includes("settling"));
  assert.equal(answerBlocks(mock.state.doc.toString())[0]?.complete, true);
});
