import { isCliProvider, type DiarySettings } from "../types";
import type { Provider } from "./provider";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { CliProvider } from "./cli";

export function createProvider(settings: DiarySettings): Provider {
  if (isCliProvider(settings.provider)) return new CliProvider(settings.provider, { ...settings.cli[settings.provider] });
  const options = { ...settings.providers[settings.provider], maxTokens: settings.maxTokens, transport: settings.transport };
  return settings.provider === "anthropic" ? new AnthropicProvider(options) : new OpenAIProvider(options);
}
