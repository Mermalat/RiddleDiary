/** Explicit opt-in live test: sends only this script's synthetic entry, never vault notes. */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const id = process.argv[2];
if (!["codex-cli", "claude-code", "gemini-cli"].includes(id)) throw new Error("Usage: node scripts/smoke-cli.mjs codex-cli|claude-code|gemini-cli");
const directory = await mkdtemp(join(tmpdir(), "riddle-diary-live-"));
try {
  await build({
    stdin: { contents: `import { CliProvider } from './providers/cli';\nconst id=process.argv[2];\nconst commands={'codex-cli':'codex','claude-code':'claude','gemini-cli':'gemini'};\nconst provider=new CliProvider(id,{executable:commands[id],model:''});\nconst signal=AbortSignal.timeout(90000);\n(async()=>{for await(const text of provider.streamReply([{role:'user',content:'Bu bir bağlantı testidir. Türkçe tek kısa cümleyle, eski bir günlük gibi merhaba de.'}], 'You are a mysterious but kind diary. Answer in one short sentence in Turkish.',signal)) process.stdout.write(text);process.stdout.write('\\n');})().catch(e=>{console.error(e.message);process.exitCode=1;});`, resolveDir: root },
    outfile: join(directory, "smoke.cjs"), bundle: true, platform: "node", format: "cjs",
    alias: { obsidian: join(root, "tests/obsidian-mock.ts") }
  });
  const status = await new Promise(resolve => {
    const child = spawn(process.execPath, [join(directory, "smoke.cjs"), id], { stdio: "inherit" });
    child.on("error", error => { console.error(error.message); resolve(1); });
    child.on("close", code => resolve(code ?? 1));
  });
  process.exitCode = status;
} finally { await rm(directory, { recursive: true, force: true }); }
