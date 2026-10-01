import { Notice, Platform, PluginSettingTab, Setting, type App } from "obsidian";
import type RiddleDiaryPlugin from "./main";
import { isCliProvider, PROVIDER_CONFIGS, type ApiProviderId, type DiarySettings, type ProviderId, type Transport } from "./types";
import { checkCliInstallation } from "./providers/cli-process";

export const DEFAULT_PERSONA = `You are an old, mysterious diary whose ink awakens when someone writes to you. Reply directly to the writer in your own quietly theatrical voice: observant, intimate, a little enigmatic, never pompous. Stay concise, usually 1–3 short paragraphs. Match the writer's language. Remember what has already been written. Do not narrate the writer's actions, impersonate them, or invent their feelings. Be helpful and kind; the atmosphere is fictional, not a claim of supernatural powers. Return only your reply, without a heading, provider label, or surrounding horizontal rules.`;

export const DEFAULT_SETTINGS: DiarySettings = {
  provider: "anthropic",
  providers: {
    anthropic: { apiKey: "", model: PROVIDER_CONFIGS[0]!.defaultModel },
    openai: { apiKey: "", model: PROVIDER_CONFIGS[1]!.defaultModel }
  },
  cli: {
    "codex-cli": { executable: "codex", model: "" },
    "claude-code": { executable: "claude", model: "" },
    "gemini-cli": { executable: "gemini", model: "" }
  },
  triggerFlag: "../", contextMode: "full", personaPrompt: DEFAULT_PERSONA,
  plainAssistant: false, maxTokens: 2048, transport: "stream", inkEffect: false
};

export function loadSettings(data: Partial<DiarySettings> | null): DiarySettings {
  const merged = { ...DEFAULT_SETTINGS, ...data,
    providers: {
      anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, ...data?.providers?.anthropic },
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...data?.providers?.openai }
    },
    cli: {
      "codex-cli": { ...DEFAULT_SETTINGS.cli["codex-cli"], ...data?.cli?.["codex-cli"] },
      "claude-code": { ...DEFAULT_SETTINGS.cli["claude-code"], ...data?.cli?.["claude-code"] },
      "gemini-cli": { ...DEFAULT_SETTINGS.cli["gemini-cli"], ...data?.cli?.["gemini-cli"] }
    }
  };
  if (!PROVIDER_CONFIGS.some(config => config.id === merged.provider)) merged.provider = DEFAULT_SETTINGS.provider;
  if (merged.contextMode !== "above") merged.contextMode = "full";
  if (merged.transport !== "buffered") merged.transport = "stream";
  if (typeof merged.triggerFlag !== "string" || /\s/.test(merged.triggerFlag)) merged.triggerFlag = "../";
  if (!Number.isInteger(merged.maxTokens) || merged.maxTokens < 128 || merged.maxTokens > 128000) merged.maxTokens = DEFAULT_SETTINGS.maxTokens;
  return merged;
}

export class DiarySettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: RiddleDiaryPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Riddle Diary" });
    containerEl.createEl("p", { text: "End a line with your flag and press Enter. The diary writes back beneath it." });
    containerEl.createEl("p", { cls: "riddle-diary-settings-note", text: "Replies send note context to your chosen provider. API keys are saved unencrypted in plugin data. Desktop CLI providers use the CLI's existing login; no API key is needed for an eligible signed-in account." });

    new Setting(containerEl).setName("Provider").addDropdown(dropdown => {
      for (const config of PROVIDER_CONFIGS) dropdown.addOption(config.id, config.name);
      dropdown.setValue(settings.provider).onChange(async value => {
        settings.provider = value as ProviderId;
        await this.plugin.saveSettings();
        this.display();
      });
    });
    for (const config of PROVIDER_CONFIGS) {
      if (config.kind !== "api" || isCliProvider(settings.provider)) continue;
      const id = config.id as ApiProviderId;
      new Setting(containerEl).setName(`${config.name} API key`).addText(text => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.setPlaceholder("Enter an API key").setValue(settings.providers[id].apiKey).onChange(async value => {
          settings.providers[id].apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });
      new Setting(containerEl).setName(`${config.name} model`).setDesc(`Default: ${config.defaultModel}`).addText(text => {
        text.setValue(settings.providers[id].model).onChange(async value => {
          settings.providers[id].model = value.trim();
          await this.plugin.saveSettings();
        });
      });
    }
    if (isCliProvider(settings.provider)) {
      const id = settings.provider;
      const options = settings.cli[id];
      const login = id === "codex-cli" ? "Run codex login in your terminal and sign in with ChatGPT." : id === "claude-code" ? "Run claude in your terminal and sign in with your Claude account." : "Run gemini in your terminal and choose Login with Google.";
      containerEl.createEl("h3", { text: "CLI connection" });
      containerEl.createEl("p", { text: Platform.isDesktopApp ? `${login} Then select this provider and write normally. Each reply starts a fresh CLI process using this note's conversation.` : "CLI connections need Obsidian desktop. On mobile select an API provider." });
      new Setting(containerEl).setName("CLI executable").setDesc("Command name or absolute executable path. Common Homebrew and local-bin locations are detected automatically. No shell aliases or extra arguments.").addText(text => {
        text.setValue(options.executable).onChange(async value => { options.executable = value.trim(); await this.plugin.saveSettings(); });
      });
      new Setting(containerEl).setName("CLI model (optional)").setDesc("Leave empty to use the CLI's default model. API model settings do not apply here.").addText(text => {
        text.setPlaceholder("CLI default").setValue(options.model).onChange(async value => { options.model = value.trim(); await this.plugin.saveSettings(); });
      });
      new Setting(containerEl).setName("Check CLI installation").setDesc("Checks executable and version only. It does not log in or send a note.").addButton(button => {
        button.setButtonText("Check installation").setDisabled(!Platform.isDesktopApp).onClick(async () => {
          button.setDisabled(true);
          try { new Notice(await checkCliInstallation(options.executable), 10000); }
          catch (error) { new Notice(error instanceof Error ? error.message : "Could not check this CLI."); }
          finally { button.setDisabled(false); }
        });
      });
    }
    new Setting(containerEl).setName("Trigger flag").setDesc("No whitespace. The flag must be the last text on the line. Clear the field to disable automatic replies.").addText(text => {
      text.setValue(settings.triggerFlag).onChange(async value => {
        if (/\s/.test(value)) { new Notice("The trigger flag cannot contain whitespace."); return; }
        settings.triggerFlag = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("Context").setDesc("Frontmatter is always excluded. Earlier diary replies become assistant turns.").addDropdown(dropdown => {
      dropdown.addOption("full", "Full note").addOption("above", "Only text above the cursor")
        .setValue(settings.contextMode).onChange(async value => {
          settings.contextMode = value as DiarySettings["contextMode"];
          await this.plugin.saveSettings();
        });
    });
    new Setting(containerEl).setName("Max tokens").setDesc("API output budget (128–128000). CLI tools use their own output limits; this setting does not cap CLI usage.").addText(text => {
      text.inputEl.type = "number";
      text.inputEl.min = "128";
      text.inputEl.max = "128000";
      text.setValue(String(settings.maxTokens)).onChange(async value => {
        const number = Number(value);
        if (Number.isInteger(number) && number >= 128 && number <= 128000) {
          settings.maxTokens = number;
          await this.plugin.saveSettings();
        }
      });
    });
    new Setting(containerEl).setName("Transport").setDesc("API only: live uses fetch; buffered uses requestUrl. CLI providers use local process output. Codex exec emits completed message chunks.").addDropdown(dropdown => {
      dropdown.addOption("stream", "Live streaming (fetch)").addOption("buffered", "Buffered / CORS compatible (requestUrl)")
        .setValue(settings.transport).onChange(async value => {
          settings.transport = value as Transport;
          await this.plugin.saveSettings();
        });
    });
    new Setting(containerEl).setName("Plain assistant mode").setDesc("Send no persona system prompt.").addToggle(toggle => {
      toggle.setValue(settings.plainAssistant).onChange(async value => {
        settings.plainAssistant = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("Diary persona").setDesc("Used when plain assistant mode is off.").addTextArea(text => {
      text.inputEl.rows = 8;
      text.inputEl.addClass("riddle-diary-persona");
      text.setValue(settings.personaPrompt).onChange(async value => {
        settings.personaPrompt = value;
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("Ink effect").setDesc("Let new reply lines gently fade into view. Respects reduced-motion preferences.").addToggle(toggle => {
      toggle.setValue(settings.inkEffect).onChange(async value => {
        settings.inkEffect = value;
        await this.plugin.saveSettings();
      });
    });
    containerEl.createEl("p", { text: "Commands: Diary: reply now · Diary: cancel reply. Escape cancels the active note's reply while its editor is focused." });
  }
}
