import { DiaryError } from "./provider";
import { MAX_EVENT_CHARACTERS, MAX_RESPONSE_BYTES } from "./limits";

export interface ServerEvent {
  event: string;
  data: string;
}

/** Incremental SSE decoder: UTF-8, CRLF, multiline data, comments, and split frames. */
export async function* readSSE(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let frameLength = 0;
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_RESPONSE_BYTES) throw new DiaryError("The provider stream exceeded the diary's size limit.");
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        frameLength += line.length;
        if (frameLength > MAX_EVENT_CHARACTERS) throw new DiaryError("The provider emitted an oversized event.");
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
          frameLength = 0;
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (frameLength + buffer.length > MAX_EVENT_CHARACTERS) throw new DiaryError("The provider emitted an oversized event.");
      if (done) {
        if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
        if (data.length) yield { event, data: data.join("\n") };
        break;
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
