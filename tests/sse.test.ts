import assert from "node:assert/strict";
import { test } from "node:test";
import { readSSE } from "../providers/sse";
import { MAX_EVENT_CHARACTERS, MAX_RESPONSE_BYTES } from "../providers/limits";

test("SSE handles UTF-8 characters and CRLF split at every byte", async () => {
  const bytes = new TextEncoder().encode(': comment\r\nevent: delta\r\ndata: {"text":"mürekkep 🖋️"}\r\n\r\ndata: [DONE]\n\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events = [];
  for await (const event of readSSE(body, new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [{ event: "delta", data: '{"text":"mürekkep 🖋️"}' }, { event: "message", data: "[DONE]" }]);
});

test("oversized unfinished and multiline SSE frames are rejected and cancelled", async () => {
  for (const input of ["data: " + "x".repeat(MAX_EVENT_CHARACTERS), ("data: " + "x".repeat(1000) + "\n").repeat(8000)]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(input)); }, cancel() { cancelled = true; } });
    await assert.rejects(async () => {
      for await (const _event of readSSE(body, new AbortController().signal)) { /* drain */ }
    }, /oversized event/);
    assert.equal(cancelled, true);
  }
});

test("stream byte limit applies across many small harmless frames", async () => {
  const comment = new TextEncoder().encode(": " + "x".repeat(1_000_000) + "\n\n");
  let bytes = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(comment); bytes += comment.byteLength; }, cancel() { cancelled = true; } });
  await assert.rejects(async () => {
    for await (const _event of readSSE(body, new AbortController().signal)) { /* drain */ }
  }, /stream exceeded/);
  assert.ok(bytes > MAX_RESPONSE_BYTES);
  assert.equal(cancelled, true);
});

test("SSE supports multiline data and a final frame without a newline", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode("data: one\ndata: two\n\ndata: last")); controller.close();
  } });
  const events = [];
  for await (const event of readSSE(body, new AbortController().signal)) events.push(event.data);
  assert.deepEqual(events, ["one\ntwo", "last"]);
});

test("cancellation interrupts a pending read", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const iterator = readSSE(body, controller.signal);
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
  assert.ok(cancelled);
});
