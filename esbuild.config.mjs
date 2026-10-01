import esbuild from "esbuild";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:*", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
  format: "cjs",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: "main.js",
  banner: { js: "/* Riddle Diary — bundled plugin. Source: main.ts */" }
});
if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
