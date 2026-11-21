import { z } from "zod";

// Empty optional values are common in .env files. Normalize them before
// applying defaults/coercion; otherwise a blank secret or invalid setting used
// to bypass the entire schema and leave SMTP_PORT as a string at runtime.
const emptyToUndefined = (value: unknown) => typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const siteOrigin = z.preprocess(emptyToUndefined, z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}, "Use an HTTP(S) origin without a path, credentials, query or fragment").default("http://localhost:3000"));

export const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_SITE_URL: siteOrigin,
  APP_ENV: z.preprocess(emptyToUndefined, z.string().default("development")),
  CREDENTIALS_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(["local", "s3"]).default("local")),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.preprocess(emptyToUndefined, z.string().default("us-east-1")),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_PUBLIC_BASE_URL: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
  SMS_API_URL: optionalString,
  SMS_API_TOKEN: optionalString,
});

function readEnv() {
  // Next.js inlines NEXT_PUBLIC_* values during build; all other reads stay
  // on the server. Never include actual secret values in validation errors.
  const raw = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    APP_ENV: process.env.APP_ENV,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
    SMS_API_URL: process.env.SMS_API_URL,
    SMS_API_TOKEN: process.env.SMS_API_TOKEN,
  };
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment")))];
    throw new Error(`Invalid environment setting(s): ${keys.join(", ")}`);
  }
  return parsed.data;
}

let cached: ReturnType<typeof readEnv> | undefined;
export function env() {
  cached ??= readEnv();
  return cached;
}

export const siteUrl = () => env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
