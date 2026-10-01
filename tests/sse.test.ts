import assert from "node:assert/strict";
import { test } from "node:test";
import { readSSE } from "../providers/sse";

test("SSE handles UTF-8 characters and CRLF split at every byte", async () => {
  const bytes = new TextEncoder().encode(': comment\r\nevent: delta\r\ndata: {"text":"mürekkep 🖋️"}\r\n\r\ndata: [DONE]\n\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events = [];
  for await (const event of readSSE(body, new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [{ event: "delta", data: '{"text":"mürekkep 🖋️"}' }, { event: "message", data: "[DONE]" }]);
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
