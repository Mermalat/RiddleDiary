import { requestUrl } from "obsidian";
import { DiaryError } from "./provider";
import { MAX_RESPONSE_BYTES } from "./limits";

export interface ApiRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function checkStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  const reason: Record<number, string> = {
    400: "Check the model name, token limit, and note length.",
    401: "Check your API key.",
    403: "Your account cannot access this model or API.",
    404: "Check the model name and account access.",
    429: "Rate limit or quota reached. Try again later."
  };
  // Do not put server response bodies (which may echo secrets/context) in notes.
  throw new DiaryError(`API error ${status}. ${reason[status] ?? "The provider is unavailable. Try again later."}`);
}

export async function fetchStream(request: ApiRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST", headers: request.headers,
      body: JSON.stringify({ ...request.body, stream: true }), signal, redirect: "error"
    });
  } catch (error) {
    signal.throwIfAborted();
    throw new DiaryError("Connection failed. Check your network or select buffered transport for CORS-restricted devices.");
  }
  checkStatus(response.status);
  if (!response.body) throw new DiaryError("Streaming is unavailable. Select buffered transport in settings.");
  return response.body;
}

export async function bufferedRequest(request: ApiRequest, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let cancel: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    // requestUrl is portable and bypasses CORS, but has no streaming/abort API.
    const response = await Promise.race([
      requestUrl({ url: request.url, method: "POST", headers: request.headers,
        body: JSON.stringify({ ...request.body, stream: false }), throw: false }),
      aborted
    ]);
    signal.throwIfAborted();
    checkStatus(response.status);
    if (response.arrayBuffer.byteLength > MAX_RESPONSE_BYTES) throw new DiaryError("The provider response exceeded the diary's size limit.");
    return response.json as unknown;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DiaryError) throw error;
    throw new DiaryError("Connection failed. Check your network and provider settings.");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
