import type { SecretStorage } from "obsidian";
import type { ApiProviderId, DiarySettings } from "./types";

export type SecretStore = Pick<SecretStorage, "getSecret" | "setSecret">;
const API_PROVIDERS: ApiProviderId[] = ["anthropic", "openai"];

/** Verify the replacement before removing a legacy key from plugin settings. */
export function migrateApiKeys(settings: DiarySettings, storage: SecretStore): boolean {
  const migrated: { provider: ApiProviderId; id: string }[] = [];
  for (const provider of API_PROVIDERS) {
    const credentials = settings.providers[provider];
    if (!credentials.apiKey) continue;
    const id = `riddle-diary-${provider}-${crypto.randomUUID()}`;
    storage.setSecret(id, credentials.apiKey);
    if (storage.getSecret(id) !== credentials.apiKey) throw new Error("Secret storage could not verify the migrated key.");
    migrated.push({ provider, id });
  }
  for (const { provider, id } of migrated) {
    settings.providers[provider].secretId = id;
    settings.providers[provider].apiKey = "";
  }
  return migrated.length > 0;
}

/** Never serialize runtime credentials, including after unrelated setting edits. */
export function persistedSettings(settings: DiarySettings) {
  return {
    ...settings,
    providers: {
      anthropic: { model: settings.providers.anthropic.model, secretId: settings.providers.anthropic.secretId ?? "" },
      openai: { model: settings.providers.openai.model, secretId: settings.providers.openai.secretId ?? "" }
    }
  };
}
