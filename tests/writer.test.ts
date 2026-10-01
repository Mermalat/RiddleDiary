import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { answerBlocks, buildMessages } from "../context";
import { boldQuestion, inkField, ReplyWriter, replyRangeField, safeReplyMarkdown } from "../writer";

function harness(doc = "hello", ink = false, offset = doc.length) {
  const mock = {
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [replyRangeField, inkField] }),
    dispatch(spec: TransactionSpec) { this.state = this.state.update(spec).state; }
  };
  return { mock, writer: new ReplyWriter(mock as unknown as EditorView, offset, "cupcake answers", ink) };
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

test("question emphasis preserves Markdown structures and does not double-wrap", () => {
  assert.equal(boldQuestion("What is on this page?"), "**What is on this page?**");
  assert.equal(boldQuestion("A question  "), "**A question**  ");
  for (const text of ["", "**Already bold**", "A **bold** word", "# Heading", "> Quote", "- List", "1. List", "    code", "```ts", "| table |", "$$", "---"]) assert.equal(boldQuestion(text), text);
});

test("Enter and command replies use tidy spacing and put the cursor after the closing rule", () => {
  for (const [doc, offset] of [["hello", 5], ["hello\n", 6], ["hello\n\nnext", 5], ["hello\nnext", 5]] as const) {
    const { mock, writer } = harness(doc, false, offset);
    writer.append("reply"); writer.finish();
    const text = mock.state.doc.toString();
    assert.ok(text.startsWith("hello\n\n---\n**cupcake answers**\n\nreply\n\n---\n\n"));
    assert.ok(!text.includes("\n\n\n"));
    assert.equal(text.slice(mock.state.selection.main.head), doc.includes("next") ? "next" : "");
    assert.equal(buildMessages(text, "full", 0)[1]?.role, "assistant");
  }
});

test("completed CLI text reveals gradually, preserving settled spans and Unicode", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mock, writer } = harness("hello", true);
  const reply = "Hi 🧁! A quiet reply.";
  writer.append(reply);
  let drained = false;
  const draining = writer.drain().then(() => { drained = true; });
  t.mock.timers.tick(24);
  assert.equal(drained, false);
  assert.ok(!mock.state.doc.toString().includes(reply));
  const first = mock.state.field(inkField).iter();
  const initialMark = first.value;
  const initialTo = first.to;
  t.mock.timers.tick(24);
  assert.equal(mock.state.field(inkField).iter().value, initialMark, "old ink must not restart its animation");
  assert.equal(mock.state.field(inkField).iter().to, initialTo);
  for (let i = 0; i < 30; i++) {
    t.mock.timers.tick(24);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(mock.state.doc.toString()), "no half emoji");
  }
  await draining;
  writer.finish();
  assert.equal(answerBlocks(mock.state.doc.toString())[0]?.content, reply);
  assert.ok(mock.state.field(inkField).size > 0, "last ink survives removal of the loading marker");
});

test("Escape during visual reveal discards queued text and releases the drain wait", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mock, writer } = harness("hello", true);
  writer.append("Visible then queued private words.");
  t.mock.timers.tick(24);
  const draining = writer.drain();
  writer.finish("Reply cancelled.");
  await draining;
  t.mock.timers.tick(10000);
  assert.ok(!mock.state.doc.toString().includes("queued private words"));
  assert.ok(mock.state.doc.toString().includes("Reply cancelled."));
  assert.equal(answerBlocks(mock.state.doc.toString())[0]?.complete, true);
});

test("editing a block during visual reveal releases drain without overwriting it", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mock, writer } = harness("hello", true);
  writer.append("A reply that is still appearing.");
  const draining = writer.drain();
  const range = mock.state.field(replyRangeField)!;
  mock.dispatch({ changes: { from: range.bodyFrom, to: range.bodyTo, insert: "my edit" } });
  t.mock.timers.tick(24);
  await draining;
  const text = mock.state.doc.toString();
  writer.finish("Cancelled.");
  assert.equal(mock.state.doc.toString(), text);
});
