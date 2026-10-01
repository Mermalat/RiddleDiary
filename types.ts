export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type ApiProviderId = "anthropic" | "openai";
export type CliProviderId = "codex-cli" | "claude-code" | "gemini-cli";
export type ProviderId = ApiProviderId | CliProviderId;
export type Transport = "stream" | "buffered";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  label: string;
  defaultModel: string;
  kind: "api" | "cli";
}

export const PROVIDER_CONFIGS: readonly ProviderConfig[] = [
  { id: "anthropic", kind: "api", name: "Anthropic (Claude)", label: "Claude answers", defaultModel: "claude-sonnet-5-5" },
  { id: "openai", kind: "api", name: "OpenAI (Codex)", label: "Codex answers", defaultModel: "gpt-5.3-codex" },
  { id: "codex-cli", kind: "cli", name: "Codex CLI (ChatGPT login · desktop)", label: "Codex answers", defaultModel: "" },
  { id: "claude-code", kind: "cli", name: "Claude Code (CLI login · desktop)", label: "Claude answers", defaultModel: "" },
  { id: "gemini-cli", kind: "cli", name: "Gemini CLI (Google login · desktop)", label: "Gemini answers", defaultModel: "" }
];

export function isCliProvider(id: ProviderId): id is CliProviderId {
  return id === "codex-cli" || id === "claude-code" || id === "gemini-cli";
}

export interface CliSettings {
  executable: string;
  model: string;
}

export interface ProviderCredentials {
  apiKey: string;
  model: string;
}

export interface DiarySettings {
  provider: ProviderId;
  providers: Record<ApiProviderId, ProviderCredentials>;
  cli: Record<CliProviderId, CliSettings>;
  triggerFlag: string;
  contextMode: "full" | "above";
  personaPrompt: string;
  plainAssistant: boolean;
  maxTokens: number;
  transport: Transport;
  inkEffect: boolean;
}
