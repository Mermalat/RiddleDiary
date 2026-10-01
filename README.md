# Riddle Diary

An Obsidian community plugin inspired by the enchanted diary in *Harry Potter and the Chamber of Secrets*. You write in a Markdown note; Claude or OpenAI writes back in the same note, with a concise, mysterious diary voice.

This is an independent fan-inspired project, with no affiliation to the Harry Potter rights holders, Anthropic, OpenAI, or Obsidian. It is ready for local installation; it has not been submitted to Obsidian's community catalogue.

## Quick start

1. Install and enable the plugin using the instructions below.
2. Open **Settings → Riddle Diary**. Set your **Diary name** (default: `cupcake`), then choose an API provider and enter its API key, or choose a desktop CLI provider that is already signed in in your terminal. Enable **Ink effect** to watch the reply appear gradually.
3. In a saved Markdown note in editing mode, type a line ending with `../` and press **Enter**:

   ```text
   What secret does an empty page keep?../
   ```

4. The flag disappears. A reply block immediately appears below your line:

   ```markdown
   ---
   **cupcake answers**

   *the ink is settling...*

   ---
   ```

5. Streamed text replaces the placeholder. Write your next entry below the closing rule.

Your diary name is independent of the provider: Claude, OpenAI and all CLI connections use **cupcake answers** until you change the name. When the persona is enabled, the diary is also told its name. Plain assistant mode still sends no system prompt. Older provider-labelled replies remain readable as conversation history; changing the name does not rewrite old notes.

Plain-text question lines become **bold** when submitted. Existing headings, lists, quotes, code, tables and already-bold text keep their formatting. Replies have one blank line between each part, with no extra empty line left by Enter. The reply block is closed from the moment it is inserted; network errors, cancellation, and timeouts keep it closed. Errors include a short explanation and retain any visible partial reply. An invisible status comment distinguishes unfinished/error/preview blocks from genuine completed assistant turns.

Commands appear in Obsidian with the plugin prefix:

- **Riddle Diary: Diary: reply now** — reply after the current line without needing a flag.
- **Riddle Diary: Diary: cancel reply** — cancel the active note's reply.
- **Riddle Diary: Diary: preview ink (offline)** — stream a predetermined, clearly marked sample without an API key or network request. Useful for trying the writing effect. Preview text is excluded from assistant history.

**Escape** cancels while the replying editor is focused. Only one reply may run per note, including when that note is open in multiple panes. Different notes can reply independently.

## Settings

| Setting | Behavior / default |
| --- | --- |
| Diary name | `cupcake`; applies across providers; one plain-text line, up to 60 characters |
| Provider | Anthropic/OpenAI APIs, Codex CLI, Claude Code, Gemini CLI; default Anthropic |
| API keys | Separate password-style inputs, stored in plugin data |
| Models | Editable per provider; defaults `claude-sonnet-5-5` and `gpt-5.3-codex` |
| Trigger flag | `../`; must contain no whitespace; empty disables automatic triggering |
| Context | Full note (default), or text through the current line / trigger cursor |
| CLI executable / model | Separate per CLI; command names are detected in common install locations; empty model uses the CLI default |
| Max tokens | API only: 2048 by default; 128–128000; CLI output limits are managed by the CLI |
| Transport | API only: live `fetch` (default), or buffered `requestUrl`; CLI output comes from local processes |
| Plain assistant mode | Off by default; when on, no persona system prompt is sent |
| Diary persona | Editable system prompt; preserved when plain mode is enabled |
| Ink effect | Off by default; gradual character reveal with a fade on fresh text; reduced motion skips both |

Ink works even when Codex CLI or buffered HTTP returns a completed message. Received text is revealed in small Unicode-safe batches, with adaptive pacing for long replies. Existing text stays settled as new text appears. Escape also cancels this visual reveal, discarding unrevealed text and retaining a closed cancellation block. The note stays locked until its reveal finishes. **Diary: preview ink (offline)** uses the same writer, with no provider call.

API model availability depends on your API account. Reasoning models use part of the output-token budget for reasoning; increase max tokens if the model finishes without visible text. The OpenAI API option uses the **Responses API**. The separate **Codex CLI** option uses your CLI's existing login, including ChatGPT sign-in.

## Connect a terminal CLI (desktop)

The CLI must already be installed and signed in under the same OS account as Obsidian. The plugin does not install CLIs or copy their tokens. Sign in in your terminal, then select the matching provider:

| Provider | Terminal setup | Default executable |
| --- | --- | --- |
| Codex CLI | `codex login` → sign in with ChatGPT; check with `codex login status` | `codex` |
| Claude Code | Run `claude` and complete login; check with `claude auth status` | `claude` |
| Gemini CLI | Run `gemini` and choose Login with Google | `gemini` |

In **Settings → Riddle Diary**, choose that provider. Leave the model empty initially and click **Check installation**. Then write a normal `../` entry. API keys are unnecessary when the CLI is already using an eligible account login. Account entitlements, rate limits and any CLI-configured billing still apply; this does not turn a subscription into a general-purpose API key. See [Codex authentication](https://developers.openai.com/codex/auth), [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference), and [Gemini authentication](https://geminicli.com/docs/get-started/authentication/).

If Obsidian cannot find the command, run `command -v codex`, `command -v claude`, or `command -v gemini` in your terminal and paste the resulting absolute path into **CLI executable**. Paths with spaces work. Shell aliases, shell functions, command strings with extra arguments, and Windows `.cmd`/`.bat` wrappers are not executed. On Windows use a native executable or a dedicated native launcher; npm shim auto-discovery and Windows process-tree cancellation have not been live-tested.

Each reply starts a fresh process in an isolated temporary directory. Note context and role-tagged conversation history go to its stdin as JSON; the note is not added to command-line arguments. CLI tools receive the same context selection and editable persona as API providers. CLI history is reconstructed from the note rather than resumed from a terminal session. The serialized history is part of a single CLI prompt, rather than separate native API turns.

- **Codex:** `exec --json`, ephemeral session, read-only sandbox, no approval prompts, shell tool and web search disabled, MCP configuration omitted, project instructions and memories disabled. User config/rules are skipped while the existing authentication location is retained. An empty model uses the CLI's built-in default; set a model explicitly to override it. Only completed agent-message events are inserted, so Codex appears in completed-message chunks rather than token by token. See [non-interactive mode](https://developers.openai.com/codex/noninteractive).
- **Claude Code:** `--print --output-format stream-json --include-partial-messages`, built-in tools disabled, strict empty MCP configuration, safe mode and no saved session. Authentication remains available in safe mode. Only main-turn text deltas are inserted; reasoning, tool output and repeated final text are omitted. See [programmatic streaming](https://code.claude.com/docs/en/headless).
- **Gemini:** headless streaming JSON, extensions disabled, hooks disabled by local settings, a deny-all tool policy, and persona through `GEMINI_SYSTEM_MD`. Cached authentication stays under the CLI's control. Interactive browser login is suppressed; sign in from a terminal first. Gemini can retain its own session/cache data under its usual home directory. Only assistant message chunks are inserted. See [headless output](https://geminicli.com/docs/cli/headless/) and [policy engine](https://geminicli.com/docs/reference/policy-engine/).

These protections restrict the coding agents' tools; they are not an OS isolation boundary for the executable itself. Only configure a CLI executable you trust. Managed CLI policies can still apply. Temporary files are removed after the process exits. Escape, the cancel command, note closure, plugin unload and the two-minute timeout terminate the spawned process (and its group on macOS/Linux); remote work already accepted by a provider may still be counted.

CLI support uses desktop-only Node modules loaded lazily after a platform check. The plugin still loads on mobile, where API providers and the offline preview work. Selecting a CLI on mobile produces a closed explanatory error block. `isDesktopOnly` remains `false`.

Verified executable versions: Codex CLI **0.159.2**, Claude Code **2.1.278**, Gemini CLI **0.46.0**. Older versions may lack the flags used here; update rather than removing the tool restrictions.

## Conversation context

- Frontmatter at the start of the note is omitted, including BOM/CRLF and unfinished metadata.
- Earlier blocks with `---`, then `**<name> answers**`, then reply text and a closing `---` become assistant turns. Custom diary names and old provider labels both work, including after a rename.
- Everything else becomes user turns. Consecutive turns with the same role are merged.
- Ordinary horizontal rules and examples inside fenced code remain user text.
- Loading, failed, cancelled, offline-preview, and incomplete blocks are omitted from assistant history.
- Triggers are ignored inside answer blocks, frontmatter, and fenced code.
- For Claude, minimal user wrappers are added when history starts or ends with an assistant turn, to meet Messages API conversation rules without assistant prefilling.
- Context is read before inserting the loading block. Full-note mode includes text after the cursor; select above-cursor mode when that is unwanted.

The plugin sends Markdown text only. It does not resolve links, read linked notes, upload attachments, or search your vault. Long notes are not silently truncated; context-window errors appear in the answer block.

## Build

Use Node.js 22 or later and npm. API providers do not require a separate Node installation. Desktop CLI providers require their usual working terminal installation; Obsidian supplies the desktop Node process API.

```sh
cd /Users/mermalat/Code/TomsDiary/TomsDiary
npm ci
npm run build
npm test
```

`npm run build` type-checks the project and writes the production `main.js`. `npm run dev` watches and rebuilds for development. `npm run check` runs TypeScript alone. CodeMirror and Obsidian are external modules provided by Obsidian itself, as in the official sample-plugin structure.

If npm reports a certificate-chain error on macOS, keep TLS verification enabled and try supplying the system CA bundle:

```sh
npm ci --cafile=/etc/ssl/cert.pem
```

## Install into a vault

### Installer

After building, run:

```sh
npm run install:vault -- "/absolute/path/to/your/vault" --demo
```

The installer copies only `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/riddle-diary/`. It preserves existing `data.json` and API keys. `--demo` adds **Riddle Diary - Start Here.md** without overwriting an existing note of that name.

Reload Obsidian, then enable **Riddle Diary** in **Settings → Community plugins**. If community plugins are disabled, enable them first. For an already-enabled development vault, this optional flag appends the plugin ID to the enabled list and backs up that list first:

```sh
npm run install:vault -- "/absolute/path/to/your/vault" --enable --demo
```

For this computer's vault:

```sh
npm run install:vault -- "/Users/mermalat/Documents/Obsidian" --enable --demo
```

Reload using the command palette's **Reload app without saving** only after your current notes are saved, or close and reopen Obsidian normally. On future rebuilds, copy/install the three files again and disable/re-enable the plugin. The installer assumes the standard `.obsidian` configuration folder; use manual installation for custom configuration folders.

### Manual / mobile installation

1. Create `<vault>/.obsidian/plugins/riddle-diary/`.
2. Copy the generated `main.js`, `manifest.json`, and `styles.css` into it.
3. Reload Obsidian and enable **Riddle Diary** in Community plugins.
4. Configure your provider and key in Riddle Diary settings.

On mobile, transfer the same three built files into the mobile vault's configuration folder using your normal file/sync mechanism. Obsidian Sync configuration sync may need to be enabled separately. Select an API provider on mobile; desktop CLI settings may sync but local executables cannot run there. Hardware Enter and mobile keyboard Enter are supported through the CM6 transaction extension; use the command fallback for keyboards that produce unusual composition events.

## Streaming and CORS

The live transport uses `fetch`, `ReadableStream`, an incremental SSE decoder, and `AbortController`. Claude calls `https://api.anthropic.com/v1/messages`; OpenAI calls `https://api.openai.com/v1/responses`. Only text deltas are written; reasoning events are not rendered. HTTP failures, provider error events, token-limit endings, malformed streams, and premature EOF are handled as failures. Requests time out after two minutes.

Obsidian's [`requestUrl`](https://docs.obsidian.md/Reference/TypeScript%20API/requestUrl) bypasses CORS but exposes a completed response, not an incremental stream or cancellation signal. Therefore live streaming cannot use it. Claude's browser-access header allows direct browser requests where supported. Device WebViews, network policies, or provider CORS rules may still prevent live `fetch` streaming. The plugin never disables certificate checks and never uses a public relay.

If live streaming fails on desktop or mobile, explicitly choose **Buffered / CORS compatible (requestUrl)**. This sends a non-streaming request and keeps the placeholder until the response arrives. Cancellation stops waiting and prevents further editor writes, but **cannot stop the buffered HTTP request at the provider**. There is no automatic fallback/retry, avoiding duplicate requests and charges.

## Data and privacy

Replying sends the selected note context and, when enabled, your persona prompt to the selected AI provider. API requests may incur provider charges. OpenAI requests set `store: false`; this is not a guarantee of zero provider retention. Consult your provider's policies.

API keys are saved by Obsidian in `.obsidian/plugins/riddle-diary/data.json` **without encryption** as requested. Password fields conceal them on screen only. Keep that file out of public repositories and account for any vault/config sync. This project ignores `data.json` in Git. CLI executable/model settings are saved there too; CLI login tokens are not read or copied by the plugin. It invokes the signed-in CLI, which manages its own credentials, retention and provider connection. The plugin adds no telemetry; provider CLIs may have their own telemetry settings.

## Edge cases and limits

Handled:

- Paste/drop/completion/undo/composition and plugin-generated edits do not activate the flag.
- Nonempty selections, multiple cursors, flags followed by trailing text/space, and unsaved notes do not trigger.
- Ordinary horizontal rules, fenced examples, frontmatter, mixed-provider history, and future provider labels parse separately.
- Cancellation, missing keys/CLI executables, CLI login failures, nonzero exits, incomplete or malformed JSONL, HTTP errors, token-limit endings, SSE errors, split UTF-8 characters, and disconnected streams leave closed blocks.
- CLI stdout excludes input echoes, reasoning and tool output; raw stderr and provider error bodies are never copied to the note. Oversized output is stopped. Installation upgrades preserve previous API keys and settings.
- Outside edits map the reply range and cursor through CodeMirror transactions. Editing/deleting the active reply stops further writes and respects the user's changes.
- Provider-generated standalone `---` lines become `***` to preserve the outer wrapper. Unfinished code fences are temporarily balanced so the closing rule remains outside code.
- A note rename retains its active-reply lock because locks use file objects rather than paths.
- Closing/replacing the replying editor aborts the request and discards pending writes. Its last closed, status-marked block can remain in the note and is excluded from assistant history.

Deliberately not implemented / not yet live-verified:

- No resumable requests, automatic retry, tool calls, attachment processing, token counting, or vault-wide context.
- A manually typed top-level horizontal rule inside an old answer block is ambiguous; the first unfenced `---` closes it. Generated replies avoid this ambiguity.
- Other plugins that reformat whole notes or external sync changes may interrupt a reply. Remote edits are not reconciled into an active API conversation.
- Editor undo is native CodeMirror history; a streamed reply is not guaranteed to be one undo step.
- The optional user-line sinking animation is omitted. The reply effect animates newly revealed text; it does not fade the user's entry.
- Device-specific mobile CORS/keyboard behavior and real authenticated provider responses require live testing with your API account and mobile device. Mocked API tests do not establish that account's model availability.

## Verification

`npm test` runs regression tests for conversation parsing, triggers, tracked editor writes, SSE framing/UTF-8/cancellation, Claude/OpenAI request formats, text-only streaming, buffered responses, missing keys, sanitized errors, premature EOF, and token-limit endings. It bundles tests into a temporary directory and substitutes a test-only Obsidian HTTP adapter; the adapter is never bundled into the plugin.

Version 1.2.0: the production build and 53 regression tests pass. New tests cover diary-name migration, provider-independent identity, plain mode, mixed old/custom-label history, question formatting, spacing and cursor placement, gradual completed-message reveal, settled ink decorations, Unicode, and cancellation or edits during reveal. Tests also include all three CLI output formats, no-shell/stdin handling, real child-process cancellation, login prompts and the mobile platform guard.

Desktop verification on October 1, 2026: version 1.2.0 is installed and loaded in Obsidian 1.13.7; `main.js`, `manifest.json` and `styles.css` match the build. The **Riddle Diary - cupcake** note shows the new name, bold questions, a visible fresh-ink fade during the offline preview, and a real Codex CLI reply introducing itself as cupcake. The Enter trigger removed its flag and the completed reply remained inside closed rules. Existing Codex login and ink preferences were retained.

Earlier desktop checks in Obsidian 1.13.7 confirmed trigger removal, closed error blocks, offline streaming and Escape. Codex CLI produced a real Turkish reply using the existing ChatGPT login and recalled its earlier greeting in a second reply in **Riddle Diary - CLI Deneme**. Claude Code and Gemini authenticated replies, API account availability and real mobile-device behavior remain unverified.

Optional real-account CLI smoke test (sends a synthetic one-sentence entry, never vault content):

```sh
node scripts/smoke-cli.mjs codex-cli
node scripts/smoke-cli.mjs claude-code
node scripts/smoke-cli.mjs gemini-cli
```

For a manual smoke test, open the Start Here note, run **Diary: preview ink (offline)**, and watch the text arrive. Run it again and press Escape halfway through. Then configure a real key, write a flagged line, press Enter, and verify the flag is removed and a completed provider reply appears. Repeat with a second entry to test conversation memory.

## Full project tree

```text
TomsDiary/
├── .gitignore
├── LICENSE
├── README.md
├── manifest.json
├── versions.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── esbuild.config.mjs
├── main.ts
├── main.js                      # generated by npm run build
├── trigger.ts
├── context.ts
├── writer.ts
├── settings.ts
├── types.ts
├── styles.css
├── providers/
│   ├── provider.ts
│   ├── index.ts
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── cli.ts
│   ├── cli-process.ts
│   ├── transport.ts
│   └── sse.ts
├── scripts/
│   ├── install.mjs
│   ├── test.mjs
│   └── smoke-cli.mjs
├── tests/
│   ├── context.test.ts
│   ├── trigger.test.ts
│   ├── writer.test.ts
│   ├── sse.test.ts
│   ├── providers.test.ts
│   ├── cli.test.ts
│   ├── settings.test.ts
│   └── obsidian-mock.ts
└── examples/
    └── Riddle Diary - Start Here.md
```

`node_modules/` is generated by npm and is not shipped to the vault.

## Development references

- [Official Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian editor extensions](https://docs.obsidian.md/Plugins/Editor/Editor%20extensions)
- [Communicating with editor extensions](https://docs.obsidian.md/Plugins/Editor/Communicating%20with%20editor%20extensions)
- [Claude Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Claude models](https://platform.claude.com/docs/en/models/overview)
- [OpenAI Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
- [GPT-5.3-Codex API model](https://developers.openai.com/api/docs/models/gpt-5.3-codex)

MIT licensed. See [LICENSE](LICENSE).
