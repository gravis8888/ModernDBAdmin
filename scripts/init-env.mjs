import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const envPath = path.join(projectRoot, ".env");

if (fs.existsSync(envPath)) {
  console.error(".env はすでに存在します。必要なら手動で編集してください。");
  process.exit(1);
}

const envFile = `# Modern DB Admin Docker settings
# 公開ドメインへ変更してください
MODERN_DB_ADMIN_DOMAIN=admin.example.com

# Let's Encrypt 通知先メールアドレスへ変更してください
MODERN_DB_ADMIN_ACME_EMAIL=admin@example.com

# 自動生成済み。必要なら入れ替えて構いません
JWT_SECRET=${randomBytes(32).toString("hex")}
ENCRYPTION_KEY=${randomBytes(32).toString("hex")}
`;

fs.writeFileSync(envPath, envFile, "utf8");

console.log(".env を作成しました。");
console.log("MODERN_DB_ADMIN_DOMAIN と MODERN_DB_ADMIN_ACME_EMAIL を本番値へ変更してから使ってください。");
