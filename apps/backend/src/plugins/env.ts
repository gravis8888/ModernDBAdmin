import { z } from "zod";

const defaultJwtSecret = "change-me-please-change-me";
const defaultEncryptionKey = "0123456789abcdef0123456789abcdef";
const defaultCorsOrigin = "http://localhost:5173";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(16).default(defaultJwtSecret),
  ENCRYPTION_KEY: z.string().min(32).default(defaultEncryptionKey),
  SQLITE_DB_PATH: z.string().default("./data/app.sqlite"),
  CORS_ORIGIN: z.string().default(defaultCorsOrigin),
});

const parsedEnv = envSchema.parse(process.env);

if (parsedEnv.NODE_ENV === "production") {
  const errors = [
    parsedEnv.JWT_SECRET === defaultJwtSecret ? "JWT_SECRET must be changed in production." : null,
    parsedEnv.ENCRYPTION_KEY === defaultEncryptionKey
      ? "ENCRYPTION_KEY must be changed in production."
      : null,
    parsedEnv.CORS_ORIGIN === defaultCorsOrigin
      ? "CORS_ORIGIN must be set to the deployed frontend origin in production."
      : null,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}

export const env = parsedEnv;
