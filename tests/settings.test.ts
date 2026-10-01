import assert from "node:assert/strict";
import { test } from "node:test";
import { diaryIdentity, loadSettings, normalizeDiaryName } from "../settings";
import { buildMessages, insideAnswer } from "../context";

test("old settings gain a diary name while keeping the provider and ink preference", () => {
  const settings = loadSettings({ provider: "codex-cli", inkEffect: true });
  assert.equal(settings.diaryName, "cupcake");
  assert.equal(settings.provider, "codex-cli");
  assert.equal(settings.inkEffect, true);
});

test("diary identity is independent of the provider and preserves plain mode", () => {
  const settings = loadSettings({ diaryName: "cupcake" });
  assert.equal(diaryIdentity(settings).label, "cupcake answers");
  assert.ok(diaryIdentity(settings).systemPrompt.includes('Your diary name is "cupcake"'));
  settings.provider = "codex-cli";
  assert.equal(diaryIdentity(settings).label, "cupcake answers");
  settings.plainAssistant = true;
  assert.equal(diaryIdentity(settings).systemPrompt, "");
});

test("diary names stay on a safe label line and mixed old/new history still parses", () => {
  assert.equal(normalizeDiaryName(" **cupcake**\n "), "cupcake");
  assert.equal(normalizeDiaryName(null), "cupcake");
  assert.equal(normalizeDiaryName(""), "cupcake");
  assert.equal(normalizeDiaryName("a".repeat(100)).length, 60);
  const note = "**Hello**\n\n---\n**Codex answers**\nOld reply.\n\n---\n\n**Again**\n\n---\n**cupcake answers**\nNew reply.\n\n---";
  assert.deepEqual(buildMessages(note, "full", 0).map(message => message.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(insideAnswer(note, note.indexOf("New reply.")), true);
});
