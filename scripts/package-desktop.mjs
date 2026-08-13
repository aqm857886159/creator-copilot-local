import { cp, lstat, mkdtemp, readdir, readlink, rm, symlink, unlink } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const staging = await mkdtemp(join(tmpdir(), "creator-copilot-package-"));
const copyTargets = ["dist", "dist-electron", "electron", "apps/desktop", "package.json", "package-lock.json"];

async function run(command, args, cwd) {
  const exitCode = await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...process.env, npm_config_ignore_scripts: "true" } });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} 失败（${exitCode}）`);
}

async function normalizeInternalSymlinks(directory, sourceRoot = directory, destinationRoot = directory) {
  const sourceRelease = realpathSync(sourceRoot);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const currentPath = join(directory, entry.name);
    const info = await lstat(currentPath);
    if (info.isSymbolicLink()) {
      const link = await readlink(currentPath);
      if (link.startsWith("/")) {
        const target = realpathSync(link);
        if (target === sourceRelease || target.startsWith(`${sourceRelease}/`)) {
          const mappedTarget = `${destinationRoot}${target.slice(sourceRelease.length)}`;
          const relativeTarget = relative(dirname(currentPath), mappedTarget);
          await unlink(currentPath);
          await symlink(relativeTarget, currentPath);
        }
      }
      continue;
    }
    if (info.isDirectory()) await normalizeInternalSymlinks(currentPath, sourceRoot, destinationRoot);
  }
}

try {
  for (const target of copyTargets) await cp(join(root, target), join(staging, target), { recursive: true, force: true });
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--include=dev", "--ignore-scripts"], staging);
  const builder = join(staging, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
  if (!existsSync(builder)) throw new Error("staging 目录缺少 electron-builder");
  const exitCode = await new Promise((resolve) => {
    const child = spawn(builder, ["--dir"], { cwd: staging, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) throw new Error(`electron-builder 失败（${exitCode}）`);
  await normalizeInternalSymlinks(join(staging, "release"));
  await rm(join(root, "release"), { recursive: true, force: true });
  await cp(join(staging, "release"), join(root, "release"), { recursive: true, force: true });
  await normalizeInternalSymlinks(join(root, "release"), join(staging, "release"), join(root, "release"));
} finally {
  await rm(staging, { recursive: true, force: true });
}
