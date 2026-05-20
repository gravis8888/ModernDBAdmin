import { spawn, spawnSync } from "node:child_process";

function isNodeScript(target) {
  return /\.(cjs|mjs|js)$/i.test(target);
}

export function resolvePackageManager() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    if (isNodeScript(npmExecPath)) {
      return {
        command: process.execPath,
        baseArgs: [npmExecPath],
      };
    }

    return {
      command: npmExecPath,
      baseArgs: [],
    };
  }

  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    baseArgs: [],
  };
}

export function spawnPackageManager(args, options = {}) {
  const runner = resolvePackageManager();
  return spawn(runner.command, [...runner.baseArgs, ...args], options);
}

export function spawnPackageManagerSync(args, options = {}) {
  const runner = resolvePackageManager();
  return spawnSync(runner.command, [...runner.baseArgs, ...args], options);
}
