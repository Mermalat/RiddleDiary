import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "../providers/anthropic";
import { OpenAIProvider } from "../providers/openai";
import type { Provider, ProviderOptions } from "../providers/provider";

const options: ProviderOptions = { apiKey: "fake-test-key", model: "test-model", maxTokens: 2048, transport: "stream" };
async function collect(provider: Provider, signal = new AbortController().signal) {
  let result = "";
  for await (const chunk of provider.streamReply([{ role: "user", content: "hello" }], "persona", signal)) result += chunk;
  return result;
}

function stream(events: unknown[]) {
  return new Response(events.map(data => `data: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("Claude sends Messages API fields and yields only text deltas", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string);
    assert.equal(body.system, "persona");
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.stream, true);
    assert.equal((init.headers as Record<string, string>)["x-api-key"], "fake-test-key");
    return stream([
      { type: "ping" },
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "not diary text" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "writer." } },
      { type: "message_stop" }
    ]);
  });
  assert.equal(await collect(new AnthropicProvider(options)), "Hello writer.");
});

test("OpenAI sends Responses API fields and ignores reasoning events", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body as string);
    assert.equal(body.instructions, "persona");
    assert.equal(body.max_output_tokens, 2048);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.deepEqual(body.input, [{ role: "user", content: "hello" }]);
    return stream([
      { type: "response.reasoning_summary_text.delta", delta: "hidden" },
      { type: "response.output_text.delta", delta: "Ink " },
      { type: "response.output_text.delta", delta: "answers." },
      { type: "response.completed" }
    ]);
  });
  assert.equal(await collect(new OpenAIProvider(options)), "Ink answers.");
});

test("plain assistant requests omit persona fields", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    assert.ok(!("system" in body) && !("instructions" in body));
    return body.max_tokens ? stream([{ type: "message_stop" }]) : stream([{ type: "response.completed" }]);
  });
  for (const provider of [new AnthropicProvider(options), new OpenAIProvider(options)]) {
    for await (const _chunk of provider.streamReply([{ role: "user", content: "hello" }], "", new AbortController().signal)) { /* drain */ }
  }
});

test("HTTP errors never expose response secrets in note messages", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("secret provider echo fake-test-key", { status: 401 }));
  for (const provider of [new AnthropicProvider(options), new OpenAIProvider(options)]) {
    await assert.rejects(collect(provider), error => error instanceof Error && error.message.includes("401") && !error.message.includes("fake-test-key"));
  }
});

test("missing keys fail without a network call", async t => {
  t.mock.method(globalThis, "fetch", () => { assert.fail("must not call fetch"); });
  for (const provider of [new AnthropicProvider({ ...options, apiKey: "" }), new OpenAIProvider({ ...options, apiKey: "" })]) {
    await assert.rejects(collect(provider), /Add an API key/);
  }
});

test("premature EOF, provider errors, and token-limit endings are errors", async t => {
  let events: unknown[] = [];
  t.mock.method(globalThis, "fetch", async () => stream(events));
  const cases: [Provider, unknown[]][] = [
    [new AnthropicProvider(options), [{ type: "content_block_delta", delta: { type: "text_delta", text: "partial" } }]],
    [new AnthropicProvider(options), [{ type: "error" }]],
    [new AnthropicProvider(options), [{ type: "message_delta", delta: { stop_reason: "max_tokens" } }, { type: "message_stop" }]],
    [new OpenAIProvider(options), [{ type: "response.output_text.delta", delta: "partial" }]],
    [new OpenAIProvider(options), [{ type: "response.failed" }]],
    [new OpenAIProvider(options), [{ type: "response.incomplete" }]]
  ];
  for (const [provider, fixture] of cases) { events = fixture; await assert.rejects(collect(provider)); }
});

test("both buffered providers extract text and send stream:false", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(JSON.parse(init.body as string).stream, false);
    return new Response(JSON.stringify(url.includes("anthropic") ? { content: [{ type: "text", text: "Claude buffered" }], stop_reason: "end_turn" } : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OpenAI buffered" }] }] }));
  });
  assert.equal(await collect(new AnthropicProvider({ ...options, transport: "buffered" })), "Claude buffered");
  assert.equal(await collect(new OpenAIProvider({ ...options, transport: "buffered" })), "OpenAI buffered");
});

test("buffered cancellation stops waiting for an uncancellable HTTP request", async t => {
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(() => {}));
  const controller = new AbortController();
  const pending = collect(new OpenAIProvider({ ...options, transport: "buffered" }), controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
});
