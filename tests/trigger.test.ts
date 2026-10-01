import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, Transaction } from "@codemirror/state";
import { matchTrigger } from "../trigger";
import { diaryEdit } from "../writer";

function enter(doc: string, event = "input", cursor = doc.length, insert = "\n") {
  return EditorState.create({ doc, selection: { anchor: cursor } }).update({
    changes: { from: cursor, insert }, annotations: Transaction.userEvent.of(event)
  });
}

test("only Enter at the end of a flagged line triggers", () => {
  assert.deepEqual(matchTrigger(enter("Hello../"), "../"), { flagFrom: 5, flagTo: 8, insertion: 9 });
  assert.ok(matchTrigger(enter("Hello@@"), "@@"));
  assert.equal(matchTrigger(enter("Hello../ "), "../"), null);
  assert.equal(matchTrigger(enter("Hello../suffix", "input", 8), "../"), null);
});

test("paste, drop, autocomplete, undo, composition, and own changes cannot trigger", () => {
  for (const event of ["input.paste", "input.drop", "input.complete", "undo", "input.type.compose"]) {
    assert.equal(matchTrigger(enter("Hello../", event), "../"), null);
  }
  const state = EditorState.create({ doc: "Hello../", selection: { anchor: 8 } });
  const transaction = state.update({ changes: { from: 8, insert: "\n" }, annotations: [Transaction.userEvent.of("input"), diaryEdit.of(true)] });
  assert.equal(matchTrigger(transaction, "../"), null);
});

test("paste of several lines and selections are ignored", () => {
  assert.equal(matchTrigger(enter("Hello../", "input", 8, "\nmore\n"), "../"), null);
  const state = EditorState.create({ doc: "Hello../", selection: { anchor: 0, head: 8 } });
  assert.equal(matchTrigger(state.update({ changes: { from: 0, to: 8, insert: "\n" }, annotations: Transaction.userEvent.of("input") }), "../"), null);
});

test("trigger is excluded inside answers, frontmatter, and code", () => {
  for (const doc of ["---\nkey: value../\n---", "---\nkey: value../", "user\n---\n**Claude answers**\nreply../\n---", "```\ncode../\n```", "~~~\ncode../\n~~~"]) {
    const cursor = doc.indexOf("../") + 3;
    assert.equal(matchTrigger(enter(doc, "input", cursor), "../"), null);
  }
});

test("indentation works and empty flag disables triggering", () => {
  assert.ok(matchTrigger(enter("  Hello../", "input", 10, "\n  "), "../"));
  assert.equal(matchTrigger(enter("Hello../"), ""), null);
});
