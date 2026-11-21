import { describe, expect, it } from "vitest";
import { seedConfig } from "@/lib/seed-config";

describe("one-time owner bootstrap configuration", () => {
  const valid = { SEED_OWNER_EMAIL: " OWNER@EXAMPLE.COM ", SEED_OWNER_PASSWORD: "a-unique-random-password-123" };

  it("requires explicit credentials and never supplies the old public password", () => {
    expect(() => seedConfig({})).toThrow(/SEED_OWNER_EMAIL/);
    expect(() => seedConfig({ ...valid, SEED_OWNER_PASSWORD: "Owner@123456789" })).toThrow(/SEED_OWNER_PASSWORD/);
    expect(seedConfig(valid)).toEqual({ email: "owner@example.com", password: valid.SEED_OWNER_PASSWORD, includeDemo: false });
  });

  it("checks the bcrypt byte limit, including multibyte passwords", () => {
    expect(() => seedConfig({ ...valid, SEED_OWNER_PASSWORD: "x".repeat(73) })).toThrow(/72 UTF-8 bytes/);
    expect(() => seedConfig({ ...valid, SEED_OWNER_PASSWORD: "অ".repeat(25) })).toThrow(/72 UTF-8 bytes/);
    expect(seedConfig({ ...valid, SEED_OWNER_PASSWORD: "x".repeat(72) }).password).toHaveLength(72);
  });

  it("only enables demo data with explicit true", () => {
    expect(seedConfig({ ...valid, SEED_INCLUDE_DEMO: "true" }).includeDemo).toBe(true);
    expect(() => seedConfig({ ...valid, SEED_INCLUDE_DEMO: "yes" })).toThrow(/SEED_INCLUDE_DEMO/);
  });
});
