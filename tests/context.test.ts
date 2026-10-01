import assert from "node:assert/strict";
import { test } from "node:test";
import { answerBlocks, buildMessages, frontmatterEnd, insideAnswer } from "../context";

test("remembers mixed provider answers and discards frontmatter", () => {
  const note = "---\nsecret: not-context\n---\nHello diary\n\n---\n**Claude answers**\nWelcome.\n---\nWhat now?\n---\n**Codex answers**\nWrite on.\n---\nOne more question";
  assert.deepEqual(buildMessages(note, "full", 0), [
    { role: "user", content: "Hello diary" },
    { role: "assistant", content: "Welcome." },
    { role: "user", content: "What now?" },
    { role: "assistant", content: "Write on." },
    { role: "user", content: "One more question" }
  ]);
});

test("above-cursor context excludes later content", () => {
  const note = "first\nsecond\nprivate later text";
  assert.deepEqual(buildMessages(note, "above", note.indexOf("\nprivate")), [{ role: "user", content: "first\nsecond" }]);
});

test("ordinary horizontal rules remain user content", () => {
  const note = "intro\n---\nordinary section\n---\nend";
  assert.equal(answerBlocks(note).length, 0);
  assert.equal(buildMessages(note, "full", 0)[0]?.content, note);
});

test("future provider labels work without updating parser", () => {
  const note = "hello\n---\n**Another provider answers**\nreply\n---";
  assert.equal(buildMessages(note, "full", 0)[1]?.role, "assistant");
  assert.equal(insideAnswer(note, note.indexOf("reply")), true);
});

test("a note starting with an answer is not frontmatter", () => {
  const note = "---\n**Claude answers**\nreply\n---\nquestion";
  assert.equal(frontmatterEnd(note), 0);
  assert.equal(buildMessages(note, "full", 0)[0]?.role, "assistant");
});

test("answer examples inside fenced code are user text", () => {
  const note = "example\n```md\n---\n**Claude answers**\nfake\n---\n```\nreal question";
  assert.equal(answerBlocks(note).length, 0);
  assert.deepEqual(buildMessages(note, "full", 0), [{ role: "user", content: note }]);
});

test("fenced horizontal rules inside replies do not end the block", () => {
  const note = "question\n---\n**Claude answers**\n```md\n---\n```\nreply\n---\nnext";
  assert.equal(answerBlocks(note)[0]?.content, "```md\n---\n```\nreply");
  assert.equal(buildMessages(note, "full", 0)[2]?.content, "next");
});

test("unfinished and status-marked replies are skipped", () => {
  const note = "first\n---\n**Claude answers**\n<!-- riddle-diary:status -->\nAPI error\n---\nnext\n---\n**Codex answers**\ninterrupted";
  assert.deepEqual(buildMessages(note, "full", 0), [{ role: "user", content: "first\n\nnext" }]);
  assert.equal(insideAnswer(note, note.length), true);
});

test("CRLF and BOM frontmatter are excluded", () => {
  const note = "\uFEFF---\r\nkey: value\r\n---\r\nHello";
  assert.deepEqual(buildMessages(note, "full", 0), [{ role: "user", content: "Hello" }]);
});

test("unclosed metadata is never sent", () => {
  assert.deepEqual(buildMessages("---\nkey: hidden", "full", 0), []);
});
