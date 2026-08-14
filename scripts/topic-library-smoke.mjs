import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const fixtureRoot = join(root, ".data", "topic-library-smoke");
const workspacePath = join(fixtureRoot, "workspace");
await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(workspacePath, { recursive: true });
const appName = "Creator Copilot Local";
const candidates = process.platform === "darwin"
  ? [join(root, "release", "mac-arm64", `${appName}.app`, "Contents", "MacOS", appName), join(root, "release", "mac", `${appName}.app`, "Contents", "MacOS", appName)]
  : process.platform === "win32"
    ? [join(root, "release", "win-unpacked", `${appName}.exe`)]
    : [join(root, "release", "linux-unpacked", appName)];
const executable = candidates.find((candidate) => existsSync(candidate));
if (!executable) throw new Error(`未找到打包应用，请先运行 npm run package:desktop：${candidates.join(", ")}`);
const child = spawn(executable, ["--topic-library-smoke", "--no-sandbox"], { cwd: root, env: { ...process.env, UI_SMOKE_WORKSPACE: workspacePath, ELECTRON_ENABLE_LOGGING: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const timeout = setTimeout(() => child.kill("SIGTERM"), 30_000);
const exitCode = await new Promise((resolve) => child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
clearTimeout(timeout);
const smokeLine = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("{\"ok\""));
if (exitCode !== 0 || !smokeLine) {
  console.error(JSON.stringify({ ok: false, exitCode, stdout: stdout.slice(-3000), stderr: stderr.slice(-5000) }));
  await rm(fixtureRoot, { recursive: true, force: true });
  process.exit(1);
}
console.log(smokeLine);
await rm(fixtureRoot, { recursive: true, force: true });
