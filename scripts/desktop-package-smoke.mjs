import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const appName = "Creator Copilot Local";
const candidates = process.platform === "darwin"
  ? [join(root, "release", "mac-arm64", `${appName}.app`, "Contents", "MacOS", appName), join(root, "release", "mac", `${appName}.app`, "Contents", "MacOS", appName)]
  : process.platform === "win32"
    ? [join(root, "release", "win-unpacked", `${appName}.exe`)]
    : [join(root, "release", "linux-unpacked", appName)];
const executable = candidates.find((candidate) => existsSync(candidate));
if (!executable) throw new Error(`未找到打包应用：${candidates.join(", ")}`);
if (process.platform === "darwin") {
  const resourcesRoot = join(root, "release", "mac-arm64", `${appName}.app`, "Contents", "Resources");
  const workerEntry = join(resourcesRoot, "app.asar.unpacked", "apps", "desktop", "analysis-worker.cjs");
  if (!existsSync(workerEntry)) throw new Error(`打包产物缺少 apps/desktop utility worker：${workerEntry}`);
  const ocrSidecar = join(resourcesRoot, "app.asar.unpacked", "electron", "sidecars", "apple-vision-ocr.swift");
  if (!existsSync(ocrSidecar)) throw new Error(`打包产物缺少 Apple Vision OCR sidecar：${ocrSidecar}`);
}

const child = spawn(executable, ["--smoke", "--no-sandbox"], { cwd: root, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const timeout = setTimeout(() => child.kill("SIGTERM"), 30_000);
const exitCode = await new Promise((resolve) => child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
clearTimeout(timeout);
const smokeLine = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("{\"ok\""));
if (exitCode !== 0 || !smokeLine) {
  console.error(JSON.stringify({ ok: false, exitCode, stdout: stdout.slice(-2000), stderr: stderr.slice(-4000) }));
  process.exit(1);
}
console.log(smokeLine);
