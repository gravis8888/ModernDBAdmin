import { spawnPackageManagerSync } from "./package-manager.mjs";

const subcommand = process.argv[2];

if (!subcommand) {
  console.error("[run-workspace] 実行する workspace コマンドを指定してください。");
  process.exit(1);
}

const result = spawnPackageManagerSync(["-r", subcommand], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
  shell: false,
});

if (result.error) {
  console.error("[run-workspace] 実行に失敗しました", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
