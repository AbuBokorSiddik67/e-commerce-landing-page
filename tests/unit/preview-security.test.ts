import { afterEach, describe, expect, it, vi } from "vitest";

async function frameHeader(mode: string, previewEnabled: string) {
  vi.stubEnv("NODE_ENV", mode);
  vi.stubEnv("LANDIQ_PREVIEW_EMBED", previewEnabled);
  vi.resetModules();
  const { default: config } = await import("../../next.config");
  const rules = await config.headers!();
  return rules.find((rule) => rule.source === "/:path*")?.headers.find((header) => header.key === "X-Frame-Options")?.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("preview embedding", () => {
  it("allows opt-in development previews without disabling production frame protection", async () => {
    expect(await frameHeader("development", "1")).toBeUndefined();
    expect(await frameHeader("development", "0")).toBe("SAMEORIGIN");
    expect(await frameHeader("production", "1")).toBe("SAMEORIGIN");
  });
});
