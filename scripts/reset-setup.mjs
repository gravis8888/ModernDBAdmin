import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const sqliteBases = [
  path.resolve(repoRoot, "apps/backend/data/app.sqlite"),
  path.resolve(repoRoot, "apps/backend/apps/backend/data/app.sqlite"),
];

const removedPaths = [];

for (const sqliteBase of sqliteBases) {
  for (const suffix of ["", "-shm", "-wal"]) {
    const targetPath = `${sqliteBase}${suffix}`;
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    fs.rmSync(targetPath, { force: true });
    removedPaths.push(targetPath);
  }
}

if (removedPaths.length === 0) {
  process.stdout.write("[reset:setup] 削除対象はありませんでした\n");
} else {
  process.stdout.write("[reset:setup] 初期セットアップ用の内部DBを削除しました\n");
  for (const removedPath of removedPaths) {
    process.stdout.write(`[reset:setup] ${removedPath}\n`);
  }
}
