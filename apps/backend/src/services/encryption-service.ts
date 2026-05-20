import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "../plugins/env";
import { ApiError } from "../utils/api-error";

export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    this.key = createHash("sha256").update(env.ENCRYPTION_KEY).digest();
  }

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
  }

  decrypt(payload: string) {
    const [ivBase64, tagBase64, encryptedBase64] = payload.split(".");
    if (!ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new ApiError(500, "ENCRYPTION_PAYLOAD_INVALID", "暗号化ペイロードが不正です。");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }
}
