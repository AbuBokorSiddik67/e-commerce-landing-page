import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_SITE_URL: optionalUrl.default("http://localhost:3000"),
  APP_ENV: z.string().default("development"),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(16).optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMS_API_URL: z.string().optional(),
  SMS_API_TOKEN: z.string().optional(),
});

function readEnv() {
  // Next.js inlines NEXT_PUBLIC_* values; all other reads stay on the server.
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
  if (!parsed.success && process.env.NODE_ENV !== "test") {
    // A missing DATABASE_URL must fail loudly rather than silently corrupt data.
    if (!raw.DATABASE_URL) throw new Error("Invalid environment: DATABASE_URL is required");
  }
  return { ...raw, ...(parsed.success ? parsed.data : {}) } as z.infer<typeof envSchema>;
}

let cached: ReturnType<typeof readEnv> | undefined;
export function env() {
  cached ??= readEnv();
  return cached;
}

export const siteUrl = () => (env().NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
