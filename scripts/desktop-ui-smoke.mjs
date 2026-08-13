import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execFile = promisify(execFileCallback);
const run = async (binary, args) => {
  const result = await execFile(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
};
const root = process.cwd();
const fixtureRoot = join(root, ".data", "desktop-ui-smoke");
const workspacePath = join(fixtureRoot, "workspace");
const incomingPath = join(fixtureRoot, "incoming");
const sourcePath = join(incomingPath, "phone-take.mp4");
await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(workspacePath, { recursive: true });
await mkdir(incomingPath, { recursive: true });
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x546e7a:s=360x640:r=30:d=2.2", "-f", "lavfi", "-i", "sine=frequency=460:sample_rate=48000:duration=2.2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath]);

const appName = "Creator Copilot Local";
const candidates = process.platform === "darwin"
  ? [join(root, "release", "mac-arm64", `${appName}.app`, "Contents", "MacOS", appName), join(root, "release", "mac", `${appName}.app`, "Contents", "MacOS", appName)]
  : process.platform === "win32"
    ? [join(root, "release", "win-unpacked", `${appName}.exe`)]
    : [join(root, "release", "linux-unpacked", appName)];
const executable = candidates.find((candidate) => existsSync(candidate));
if (!executable) throw new Error(`未找到打包应用，请先运行 npm run package:desktop：${candidates.join(", ")}`);

const child = spawn(executable, ["--ui-smoke", "--no-sandbox"], { cwd: root, env: { ...process.env, UI_SMOKE_WORKSPACE: workspacePath, UI_SMOKE_SOURCE_PATH: sourcePath, AI_EDIT_PROVIDER: "local-fallback", APPLE_VISION_OCR_SCRIPT: "", ELECTRON_ENABLE_LOGGING: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const timeout = setTimeout(() => child.kill("SIGTERM"), 90_000);
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
