import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, postJson } from "@/lib/payments/types";
import { request } from "@/lib/couriers/types";
import { passwordSchema } from "@/lib/validation";

afterEach(() => vi.unstubAllGlobals());

describe("provider errors and password bounds", () => {
  it.each([
    ["payment POST", () => postJson("https://fixture.invalid", {})],
    ["payment GET", () => getJson("https://fixture.invalid")],
    ["courier", () => request("https://fixture.invalid")],
  ])("does not echo provider bodies or URLs from %s failures", async (_name, call) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ echoedSecret: "fixture-secret" }), { status: 401 })));
    await expect(call()).rejects.toThrow(/HTTP 401/);
    await expect(call()).rejects.not.toThrow(/fixture-secret/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("https://fixture.invalid/?password=fixture-secret")));
    await expect(call()).rejects.not.toThrow(/fixture-secret/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("fixture-secret", { status: 200 })));
    await expect(call()).rejects.not.toThrow(/fixture-secret/);
  });

  it("rejects new passwords that bcrypt would silently truncate, including multibyte input", () => {
    expect(passwordSchema.safeParse("x".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse("অ".repeat(24)).success).toBe(true);
    expect(passwordSchema.safeParse("অ".repeat(25)).success).toBe(false);
  });
});
