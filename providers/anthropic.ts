import type { Message } from "../types";
import { PROVIDER_CONFIGS } from "../types";
import { DiaryError, validateOptions, type Provider, type ProviderOptions } from "./provider";
import { readSSE } from "./sse";
import { bufferedRequest, fetchStream } from "./transport";

interface ClaudeEvent {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  readonly label = PROVIDER_CONFIGS.find(config => config.id === this.id)!.label;
  constructor(private readonly options: ProviderOptions) {}

  async *streamReply(messages: Message[], systemPrompt: string, signal: AbortSignal): AsyncGenerator<string> {
    validateOptions(this.options);
    // Claude requires a user-first conversation and newer models reject assistant prefills.
    const turns: Message[] = [...messages];
    if (turns[0]?.role === "assistant") turns.unshift({ role: "user", content: "Here is our earlier diary conversation." });
    if (turns.at(-1)?.role === "assistant") turns.push({ role: "user", content: "Reply to my most recent entry in this diary conversation." });
    const request = {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: {
        model: this.options.model.trim(), max_tokens: this.options.maxTokens,
        messages: turns, ...(systemPrompt ? { system: systemPrompt } : {})
      }
    };
    if (this.options.transport === "buffered") {
      const result = await bufferedRequest(request, signal) as {
        content?: Array<{ type: string; text?: string }>; stop_reason?: string;
      };
      const text = result.content?.filter(block => block.type === "text").map(block => block.text ?? "").join("");
      if (!text) throw new DiaryError("The provider returned no text.");
      yield text;
      if (result.stop_reason === "max_tokens") throw new DiaryError("Reply reached the token limit. Increase max tokens.");
      return;
    }
    const body = await fetchStream(request, signal);
    let completed = false;
    let truncated = false;
    for await (const event of readSSE(body, signal)) {
      const data = JSON.parse(event.data) as ClaudeEvent;
      if (data.type === "error") throw new DiaryError("Claude reported a streaming error. Try again later.");
      if (data.type === "content_block_delta" && data.delta?.type === "text_delta" && data.delta.text) yield data.delta.text;
      if (data.type === "message_delta" && data.delta?.stop_reason === "max_tokens") truncated = true;
      if (data.type === "message_stop") { completed = true; break; }
    }
    signal.throwIfAborted();
    if (!completed) throw new DiaryError("The stream disconnected before the reply finished.");
    if (truncated) throw new DiaryError("Reply reached the token limit. Increase max tokens.");
  }
}
