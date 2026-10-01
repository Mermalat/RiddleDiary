import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Platform } from "obsidian";
import { CliReplyDecoder, cliArguments, cliPrompt, CliProvider } from "../providers/cli";
import { desktopRuntime, resolveExecutable, runCliLines } from "../providers/cli-process";
import { loadSettings } from "../settings";
import { createProvider } from "../providers";

const event = (decoder: CliReplyDecoder, value: unknown) => decoder.decode(JSON.stringify(value));

test("CLI settings migrate without losing API keys or changing the selected provider", () => {
  const settings = loadSettings({ provider: "openai", providers: { anthropic: { apiKey: "a", model: "claude" }, openai: { apiKey: "b", model: "gpt" } } });
  assert.equal(settings.provider, "openai");
  assert.equal(settings.providers.openai.apiKey, "b");
  assert.equal(settings.cli["codex-cli"].executable, "codex");
  settings.provider = "gemini-cli";
  assert.equal(createProvider(settings).label, "Gemini answers");
  settings.cli["codex-cli"].model = "changed";
  assert.equal(loadSettings(null).cli["codex-cli"].model, "");
});

test("CLI prompt preserves roles and Unicode; plain mode omits the persona", () => {
  const messages = [{ role: "user" as const, content: "Merhaba $(touch secret)\n你好" }, { role: "assistant" as const, content: "Ink." }];
  const prompt = cliPrompt(messages, "old diary");
  const payload = JSON.parse(prompt.split("\n")[1]!);
  assert.deepEqual(payload.messages, messages);
  assert.equal(payload.system, "old diary");
  assert.ok(!("system" in JSON.parse(cliPrompt(messages, "").split("\n")[1]!)));
});

test("CLI arguments restrict agent behavior and leave the prompt out of argv", () => {
  const codex = cliArguments("codex-cli", "", "/tmp/test");
  assert.ok(codex.includes("--ephemeral") && codex.includes("read-only") && codex.includes("--ignore-user-config"));
  assert.ok(codex.includes("features.shell_tool=false"));
  const claude = cliArguments("claude-code", "my-model", "/tmp/test");
  assert.equal(claude[claude.indexOf("--tools") + 1], "");
  assert.ok(claude.includes("--safe-mode") && claude.includes("--no-session-persistence"));
  assert.equal(claude[claude.indexOf("--model") + 1], "my-model");
  assert.ok(cliArguments("gemini-cli", "", "/tmp/test").includes("/tmp/test/deny-tools.toml"));
});

test("Codex decoder emits completed agent text and skips reasoning and tool output", () => {
  const decoder = new CliReplyDecoder("codex-cli");
  assert.equal(event(decoder, { type: "item.completed", item: { type: "reasoning", text: "hidden" } }), "");
  assert.equal(event(decoder, { type: "item.completed", item: { type: "command_execution", aggregated_output: "hidden" } }), "");
  assert.equal(event(decoder, { type: "item.completed", item: { type: "agent_message", text: "Hello." } }), "Hello.");
  event(decoder, { type: "turn.completed" });
  decoder.finish();
});

test("Claude decoder streams only main-turn text and avoids repeating the final result", () => {
  const decoder = new CliReplyDecoder("claude-code");
  assert.equal(event(decoder, { type: "stream_event", event: { delta: { type: "thinking_delta", thinking: "hidden" } } }), "");
  assert.equal(event(decoder, { type: "stream_event", parent_tool_use_id: "tool", event: { delta: { type: "text_delta", text: "hidden" } } }), "");
  assert.equal(event(decoder, { type: "stream_event", event: { delta: { type: "text_delta", text: "Ink" } } }), "Ink");
  assert.equal(event(decoder, { type: "result", subtype: "success", result: "Ink" }), "");
  decoder.finish();
  const fallback = new CliReplyDecoder("claude-code");
  assert.equal(event(fallback, { type: "result", subtype: "success", result: "Ink" }), "Ink");
  fallback.finish();
});

test("Gemini decoder ignores echoed user text and streams assistant messages", () => {
  const decoder = new CliReplyDecoder("gemini-cli");
  assert.equal(event(decoder, { type: "message", role: "user", content: "private" }), "");
  assert.equal(event(decoder, { type: "message", role: "assistant", content: "Hello ", delta: true }), "Hello ");
  assert.equal(event(decoder, { type: "message", role: "assistant", content: "writer.", delta: true }), "writer.");
  event(decoder, { type: "result", status: "success" });
  decoder.finish();
});

test("malformed, failed, empty and incomplete CLI replies produce sanitized errors", () => {
  const decoder = new CliReplyDecoder("codex-cli");
  assert.throws(() => decoder.decode("secret-key-raw-error"), /unreadable stream/);
  assert.throws(() => event(decoder, { type: "error", message: "secret" }), error => error instanceof Error && !error.message.includes("secret"));
  assert.throws(() => decoder.finish(), /without a completed/);
  const gemini = new CliReplyDecoder("gemini-cli");
  assert.throws(() => event(gemini, { type: "result", status: "error", error: { message: "secret" } }), /Gemini CLI could not reply/);
});

test("mobile rejects CLI without loading a Node runtime", t => {
  t.mock.property(Platform, "isDesktopApp", false);
  assert.throws(() => desktopRuntime(), /Obsidian desktop/);
});

test("CLI resolution accepts an executable path with spaces and rejects shell commands", () => {
  const directory = mkdtempSync(join(tmpdir(), "riddle-diary-cli-test-"));
  try {
    const executable = join(directory, "my CLI");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    assert.equal(resolveExecutable(executable).executable, executable);
    assert.throws(() => resolveExecutable(`${executable}; echo leaked`), /not found/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("real child process receives stdin intact, handles UTF-8 and rejects nonzero exit without leaking stderr", async () => {
  const input = "çığ你好 $(echo SHOULD_NOT_RUN)";
  const args = ["-e", "process.stdin.setEncoding('utf8');let text='';process.stdin.on('data',s=>text+=s);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({text})+'\\n')); "];
  const lines: string[] = [];
  for await (const line of runCliLines({ executable: process.execPath, args, input, cwd: tmpdir(), env: process.env }, new AbortController().signal)) lines.push(line);
  assert.equal(JSON.parse(lines[0]!).text, input);
  await assert.rejects(async () => {
    for await (const _line of runCliLines({ executable: process.execPath, args: ["-e", "process.stderr.write('secret-token');process.exit(1)"], input: "", cwd: tmpdir(), env: process.env }, new AbortController().signal)) { /* No stdout expected. */ }
  }, error => error instanceof Error && !error.message.includes("secret-token") && error.message.includes("CLI reply failed"));
});

test("aborting an in-flight CLI terminates the spawned process", async () => {
  const controller = new AbortController();
  let pid = 0;
  await assert.rejects(async () => {
    for await (const line of runCliLines({ executable: process.execPath, args: ["-e", "console.log(process.pid);setInterval(()=>{},1000)"], input: "", cwd: tmpdir(), env: process.env }, controller.signal)) {
      pid = Number(line); controller.abort();
    }
  }, error => error instanceof Error && error.name === "AbortError");
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("headless login prompts stop immediately instead of hanging or entering a login flow", async () => {
  await assert.rejects(async () => {
    for await (const _line of runCliLines({ executable: process.execPath, args: ["-e", "process.stdout.write('Opening authentication page in your browser. Do you want to continue?');setInterval(()=>{},1000)"], input: "", cwd: tmpdir(), env: process.env }, new AbortController().signal)) { /* No assistant output. */ }
  }, /CLI login is required/);
});

test("CLI provider errors leave the API provider independent", async () => {
  const provider = new CliProvider("codex-cli", { executable: "/missing/riddle-diary-cli", model: "" });
  await assert.rejects(async () => {
    for await (const _chunk of provider.streamReply([{ role: "user", content: "hi" }], "", new AbortController().signal)) { /* No executable. */ }
  }, /executable not found/);
});
