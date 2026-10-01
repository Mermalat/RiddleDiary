import { build } from "esbuild";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = (await readdir(path.join(root, "tests"))).filter(file => file.endsWith(".test.ts"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "riddle-diary-tests-"));
try {
  await build({
    entryPoints: files.map(file => path.join(root, "tests", file)),
    outdir: temporary, bundle: true, platform: "node", format: "cjs", target: "node22", outExtension: { ".js": ".cjs" },
    alias: { obsidian: path.join(root, "tests", "obsidian-mock.ts") }
  });
  const result = spawnSync(process.execPath, ["--test", ...files.map(file => path.join(temporary, file.replace(/\.ts$/, ".cjs")))], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
