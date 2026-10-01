import { Platform } from "obsidian";
import { DiaryError } from "./provider";

// Required lazily: mobile can load the plugin without evaluating Node modules.
export function desktopRuntime() {
  if (!Platform.isDesktopApp) throw new DiaryError("CLI providers require Obsidian desktop. Choose an API provider on mobile.");
  return {
    process: require("node:process") as typeof import("node:process"),
    fs: require("node:fs") as typeof import("node:fs"),
    os: require("node:os") as typeof import("node:os"),
    path: require("node:path") as typeof import("node:path"),
    spawn: (require("node:child_process") as typeof import("node:child_process")).spawn
  };
}

export function resolveExecutable(executable: string): { executable: string; env: NodeJS.ProcessEnv } {
  const { process, fs, os, path } = desktopRuntime();
  const home = os.homedir();
  const directories = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
    path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin")
  ].filter(Boolean);
  const requested = executable.trim().replace(/^~(?=[/\\])/, home);
  if (!requested) throw new DiaryError("Set the CLI executable in Settings → Riddle Diary.");
  const candidates = path.isAbsolute(requested) ? [requested] : directories.map(directory => path.join(directory, requested));
  const found = candidates.find(candidate => {
    try { fs.accessSync(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(candidate).isFile(); }
    catch { return false; }
  });
  if (!found) throw new DiaryError("CLI executable not found. Enter its absolute path in Settings → Riddle Diary (use command -v in your terminal).");
  if (/\.(cmd|bat)$/i.test(found)) throw new DiaryError("Use a native executable or a CLI launcher, not a Windows .cmd/.bat shell script. See the README.");
  // GUI apps may lack Homebrew/Node in PATH. Include the resolved launcher's directory.
  return { executable: found, env: { ...process.env, PATH: [path.dirname(found), ...directories].join(path.delimiter), NO_COLOR: "1" } };
}

export interface CliInvocation {
  executable: string;
  args: string[];
  input: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** JSONL process transport. No shell, no prompt in argv, no raw stderr in notes. */
export async function* runCliLines(invocation: CliInvocation, signal: AbortSignal): AsyncGenerator<string> {
  signal.throwIfAborted();
  const { spawn, process } = desktopRuntime();
  const child = spawn(invocation.executable, invocation.args, {
    cwd: invocation.cwd, env: invocation.env, shell: false,
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32"
  });
  let closed = false;
  let failure: Error | undefined;
  let exitCode: number | null = null;
  let pending = "";
  const lines: string[] = [];
  let notify = () => {};
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (force = false) => {
    if (closed) return;
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      else child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch { /* The process may already have exited. */ }
  };
  const abort = () => {
    kill();
    killTimer ??= setTimeout(() => kill(true), 1000);
    notify();
  };
  const completion = new Promise<void>(resolve => child.once("close", code => {
    closed = true; exitCode = code;
    if (pending.trim()) lines.push(pending);
    pending = "";
    if (killTimer) clearTimeout(killTimer);
    notify(); resolve();
  }));
  child.once("error", () => { failure = new DiaryError("Could not launch the CLI. Check its executable path and terminal installation."); notify(); });
  child.stdin.on("error", () => { /* Exit status reports startup/auth failures. */ });
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    // Some CLIs prompt for login even in headless mode. Never feed note text
    // to an interactive login, nor wait indefinitely for a verification code.
    if (!pending.trimStart().startsWith("{") && /opening authentication|enter.*(?:authorization|verification|authentication).*code|visit.*(?:url|link).*auth|authenticate.*(?:browser|terminal)/i.test(pending)) {
      failure = new DiaryError("CLI login is required. Sign in using this CLI in your terminal, then retry from Obsidian.");
      abort(); return;
    }
    if (pending.length > 8_000_000) {
      failure = new DiaryError("The CLI emitted an oversized event."); abort(); return;
    }
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) lines.push(line);
    }
    if (lines.length > 100) child.stdout.pause();
    notify();
  });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  child.stdin.end(invocation.input);
  try {
    while (!closed || lines.length) {
      signal.throwIfAborted();
      if (failure) throw failure;
      const line = lines.shift();
      if (line !== undefined) {
        if (lines.length < 50) child.stdout.resume();
        yield line;
      } else await new Promise<void>(resolve => { notify = resolve; });
    }
    signal.throwIfAborted();
    if (failure) throw failure;
    if (exitCode !== 0) throw new DiaryError("CLI reply failed. Check login, usage limits, and CLI version in your terminal, then try again.");
  } finally {
    signal.removeEventListener("abort", abort);
    if (!closed) abort();
    child.stdout.resume();
    await completion;
  }
}

export async function checkCliInstallation(executable: string): Promise<string> {
  const resolved = resolveExecutable(executable);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let output = "";
    for await (const line of runCliLines({ ...resolved, args: ["--version"], input: "", cwd: desktopRuntime().os.tmpdir() }, controller.signal)) output += line;
    return `Found: ${resolved.executable} (${output.replace(/[^\w. ()-]/g, "").slice(0, 100) || "version checked"}). Login remains managed by the CLI.`;
  } catch (error) {
    if (controller.signal.aborted) throw new DiaryError("CLI installation check timed out.");
    throw error;
  } finally { clearTimeout(timer); }
}
