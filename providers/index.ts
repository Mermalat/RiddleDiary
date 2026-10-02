import { isCliProvider, type DiarySettings } from "../types";
import type { Provider } from "./provider";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { CliProvider } from "./cli";
import type { SecretStore } from "../credentials";

export function createProvider(settings: DiarySettings, storage?: SecretStore): Provider {
  if (isCliProvider(settings.provider)) return new CliProvider(settings.provider, { ...settings.cli[settings.provider] });
  const credentials = settings.providers[settings.provider];
  let apiKey = credentials.apiKey;
  if (credentials.secretId) {
    apiKey = "";
    try { apiKey = storage?.getSecret(credentials.secretId) ?? ""; }
    catch { /* Fail closed; provider validation writes a generic missing-key block. */ }
  }
  const options = { ...credentials, apiKey,
    maxTokens: settings.maxTokens, transport: settings.transport };
  return settings.provider === "anthropic" ? new AnthropicProvider(options) : new OpenAIProvider(options);
}
