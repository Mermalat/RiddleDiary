import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const vault = args.find(arg => !arg.startsWith("--"));
if (!vault) {
  console.error('Usage: npm run install:vault -- "/absolute/path/to/vault" [--enable] [--demo]');
  process.exit(1);
}
const configFolder = path.join(path.resolve(vault), ".obsidian");
await readFile(path.join(configFolder, "app.json"), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const target = path.join(configFolder, "plugins", manifest.id);
await mkdir(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(new URL(`../${file}`, import.meta.url), path.join(target, file));
}
if (args.includes("--enable")) {
  const configPath = path.join(configFolder, "community-plugins.json");
  let original;
  try { original = await readFile(configPath, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; original = "[]"; }
  const plugins = JSON.parse(original);
  if (!Array.isArray(plugins)) throw new Error("community-plugins.json must be an array.");
  if (!plugins.includes(manifest.id)) {
    await writeFile(`${configPath}.riddle-diary-backup-${Date.now()}`, original, { flag: "wx" });
    await writeFile(configPath, JSON.stringify([...plugins, manifest.id], null, 2) + "\n");
  }
}
if (args.includes("--demo")) {
  const content = await readFile(new URL("../examples/Riddle Diary - Start Here.md", import.meta.url), "utf8");
  try { await writeFile(path.join(vault, "Riddle Diary - Start Here.md"), content, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}
console.log(`Installed ${manifest.name} in ${target}`);
console.log("Reload Obsidian, then open Settings → Riddle Diary and choose an API or signed-in desktop CLI provider.");
