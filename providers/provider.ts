import type { Message, ProviderCredentials, ProviderId, Transport } from "../types";

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  streamReply(messages: Message[], systemPrompt: string, signal: AbortSignal): AsyncIterable<string>;
}

export interface ProviderOptions extends ProviderCredentials {
  maxTokens: number;
  transport: Transport;
}

export class DiaryError extends Error {}

export function validateOptions(options: ProviderOptions): void {
  if (!options.apiKey.trim()) throw new DiaryError("Add an API key in Settings → Riddle Diary.");
  if (!options.model.trim()) throw new DiaryError("Set a model name in Settings → Riddle Diary.");
}
