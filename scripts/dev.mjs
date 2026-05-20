import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { resolvePackageManager } from "./package-manager.mjs";

const BACKEND_HEALTH_URL = "http://127.0.0.1:3001/api/health";
const BACKEND_WAIT_TIMEOUT_MS = 30_000;
const BACKEND_WAIT_INTERVAL_MS = 500;
const DEV_LOCK_HOST = "127.0.0.1";
const DEV_LOCK_PORT = 42173;
const packageManager = resolvePackageManager();

const managedChildren = new Set();
let instanceLockServer = null;
let shuttingDown = false;

function log(message) {
  process.stdout.write(`[dev] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireInstanceLock() {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE") {
        reject(
          new Error(
            "別の `pnpm dev` が起動中です。既存の開発サーバーを使うか、先に停止してから再実行してください。",
          ),
        );
        return;
      }

      reject(error);
    });
    server.listen(DEV_LOCK_PORT, DEV_LOCK_HOST, () => {
      instanceLockServer = server;
      resolve();
    });
  });
}

async function releaseInstanceLock() {
  if (!instanceLockServer) {
    return;
  }

  const server = instanceLockServer;
  instanceLockServer = null;
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function resolveSpawnTarget(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }

  return { command, args };
}

function spawnCommand(label, command, args, options = {}) {
  log(`${label} を起動します`);
  const target = resolveSpawnTarget(command, args);

  const child = spawn(target.command, target.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: false,
    ...options,
  });

  child.once("error", (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[dev] ${label} の起動に失敗しました`, error);
    shutdown(1);
  });

  return child;
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });

      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  }

  child.kill("SIGTERM");
  return Promise.resolve();
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  const children = Array.from(managedChildren);
  await Promise.all(children.map((child) => terminateChild(child)));
  await releaseInstanceLock();
  process.exit(exitCode);
}

async function fetchBackendHealth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1_000);

  try {
    const response = await fetch(BACKEND_HEALTH_URL, {
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForBackendReady() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < BACKEND_WAIT_TIMEOUT_MS) {
    if (await fetchBackendHealth()) {
      return true;
    }

    await sleep(BACKEND_WAIT_INTERVAL_MS);
  }

  return false;
}

function watchManagedChild(label, child) {
  managedChildren.add(child);

  child.once("exit", (code, signal) => {
    managedChildren.delete(child);

    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[dev] ${label} が終了しました (${reason})`);
    shutdown(code ?? 1);
  });
}

async function runBuildStep() {
  await new Promise((resolve, reject) => {
    const build = spawnCommand("shared build", packageManager.command, [
      ...packageManager.baseArgs,
      "--filter",
      "@modern-db-admin/shared",
      "build",
    ]);

    build.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`shared build failed with code ${code ?? 1}`));
    });
  });
}

async function main() {
  await acquireInstanceLock();

  process.on("SIGINT", () => {
    shutdown(0);
  });

  process.on("SIGTERM", () => {
    shutdown(0);
  });

  await runBuildStep();

  let backendStartedHere = false;

  if (await fetchBackendHealth()) {
    log("既存のバックエンドを利用します");
  } else {
    const backend = spawnCommand("backend", packageManager.command, [
      ...packageManager.baseArgs,
      "--filter",
      "@modern-db-admin/backend",
      "dev",
    ]);

    backendStartedHere = true;
    watchManagedChild("backend", backend);

    const ready = await waitForBackendReady();

    if (!ready) {
      console.error("[dev] バックエンドが 30 秒以内に起動しませんでした");
      await shutdown(1);
      return;
    }
  }

  log("バックエンドの準備ができました");

  const frontend = spawnCommand("frontend", packageManager.command, [
    ...packageManager.baseArgs,
    "--filter",
    "@modern-db-admin/frontend",
    "dev",
  ]);

  watchManagedChild("frontend", frontend);

  if (!backendStartedHere) {
    log("フロントエンドを起動しました");
  }

  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error("[dev] 起動に失敗しました", error);
  await shutdown(1);
});
