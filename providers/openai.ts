import type { Message } from "../types";
import { PROVIDER_CONFIGS } from "../types";
import { DiaryError, validateOptions, type Provider, type ProviderOptions } from "./provider";
import { readSSE } from "./sse";
import { bufferedRequest, fetchStream } from "./transport";

interface OpenAIEvent {
  type?: string;
  delta?: string;
}

export class OpenAIProvider implements Provider {
  readonly id = "openai" as const;
  readonly label = PROVIDER_CONFIGS.find(config => config.id === this.id)!.label;
  constructor(private readonly options: ProviderOptions) {}

  async *streamReply(messages: Message[], systemPrompt: string, signal: AbortSignal): AsyncGenerator<string> {
    validateOptions(this.options);
    const request = {
      url: "https://api.openai.com/v1/responses",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey.trim()}` },
      body: {
        model: this.options.model.trim(), input: messages,
        ...(systemPrompt ? { instructions: systemPrompt } : {}),
        max_output_tokens: this.options.maxTokens, store: false
      }
    };
    if (this.options.transport === "buffered") {
      const result = await bufferedRequest(request, signal) as {
        status?: string;
        output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
      };
      const text = result.output?.filter(item => item.type === "message")
        .flatMap(item => item.content ?? []).filter(block => block.type === "output_text")
        .map(block => block.text ?? "").join("");
      if (text) yield text;
      if (result.status !== "completed") throw new DiaryError("OpenAI did not finish the reply. Check the token limit or retry.");
      if (!text) throw new DiaryError("The provider returned no text. A reasoning model may need a higher token limit.");
      return;
    }
    const body = await fetchStream(request, signal);
    let completed = false;
    for await (const event of readSSE(body, signal)) {
      if (event.data === "[DONE]") break;
      const data = JSON.parse(event.data) as OpenAIEvent;
      if (data.type === "response.output_text.delta" && data.delta) yield data.delta;
      if (data.type === "response.refusal.delta" && data.delta) yield data.delta;
      if (data.type === "error" || data.type === "response.failed") throw new DiaryError("OpenAI reported a streaming error. Check your settings or retry.");
      if (data.type === "response.incomplete") throw new DiaryError("Reply did not finish. Increase max tokens or retry.");
      if (data.type === "response.completed") { completed = true; break; }
    }
    signal.throwIfAborted();
    if (!completed) throw new DiaryError("The stream disconnected before the reply finished.");
  }
}
