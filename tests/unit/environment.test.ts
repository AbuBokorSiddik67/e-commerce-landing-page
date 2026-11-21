import { afterEach, describe, expect, it, vi } from "vitest";
import { envSchema } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const database = { DATABASE_URL: "postgresql://fixture:fixture@invalid:1/fixture" };

afterEach(() => vi.unstubAllEnvs());

describe("environment configuration", () => {
  it("normalizes blank optional values and applies defaults without bypassing validation", () => {
    const parsed = envSchema.parse({ ...database, NEXT_PUBLIC_SITE_URL: "", CREDENTIALS_ENCRYPTION_KEY: "",
      STORAGE_DRIVER: "", S3_REGION: "", SMTP_PORT: "", SMTP_HOST: "" });
    expect(parsed).toMatchObject({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", STORAGE_DRIVER: "local", S3_REGION: "us-east-1" });
    expect(parsed.SMTP_PORT).toBeUndefined();
    expect(parsed.SMTP_HOST).toBeUndefined();
    expect(parsed.CREDENTIALS_ENCRYPTION_KEY).toBeUndefined();
  });

  it("converts valid SMTP ports to numbers and rejects invalid settings", () => {
    expect(envSchema.parse({ ...database, SMTP_PORT: "465" }).SMTP_PORT).toBe(465);
    for (const port of ["0", "65536", "bad", "587.5"]) {
      expect(envSchema.safeParse({ ...database, SMTP_PORT: port }).success).toBe(false);
    }
    expect(envSchema.safeParse({ ...database, STORAGE_DRIVER: "locla" }).success).toBe(false);
    expect(envSchema.safeParse({ ...database, CREDENTIALS_ENCRYPTION_KEY: "short" }).success).toBe(false);
    expect(envSchema.safeParse({ DATABASE_URL: "" }).success).toBe(false);
  });

  it("accepts only an HTTP(S) site origin, not a path or embedded credentials", () => {
    for (const site of ["https://store.example.com", "http://localhost:3000/"]) {
      expect(envSchema.safeParse({ ...database, NEXT_PUBLIC_SITE_URL: site }).success).toBe(true);
    }
    for (const site of ["not-a-url", "javascript:alert(1)", "https://user:pass@store.example.com", "https://store.example.com/shop", "https://store.example.com/?q=1"]) {
      expect(envSchema.safeParse({ ...database, NEXT_PUBLIC_SITE_URL: site }).success).toBe(false);
    }
  });

  it("requires a sufficiently long credential-encryption key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "short-key");
    expect(() => encryptSecret("private")).toThrow(/32 bytes/);
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "a".repeat(32));
    const encrypted = encryptSecret("private");
    expect(encrypted).not.toContain("private");
    expect(decryptSecret(encrypted)).toBe("private");
  });
});
