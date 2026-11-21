import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ findUser: vi.fn(), ip: "198.51.100.42" }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: fixture.findUser } } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": fixture.ip }),
  cookies: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { requestResetAction } from "@/app/actions/auth";
import { createPasswordResetToken } from "@/lib/auth";
import { resetRateLimit } from "@/lib/rate-limit";

beforeEach(() => { fixture.findUser.mockReset().mockResolvedValue(null); });

describe("password reset request limits", () => {
  it("gives the same generic response for unknown accounts and limits repeated requests", async () => {
    fixture.ip = "198.51.100.43";
    resetRateLimit(`password-reset-ip:${fixture.ip}`);
    resetRateLimit(`password-reset-account:${fixture.ip}:missing@fixture.invalid`);
    const form = new FormData(); form.set("email", "missing@fixture.invalid");
    for (let i = 0; i < 3; i++) {
      expect(await requestResetAction(undefined, form)).toEqual({ message: "If that account exists and email is configured, a reset link will be sent." });
    }
    expect(await requestResetAction(undefined, form)).toEqual({ error: "Too many reset requests. Please try again later." });
    expect(fixture.findUser).toHaveBeenCalledTimes(3);
  });

  it("also limits one IP cycling through many different addresses", async () => {
    fixture.ip = "198.51.100.44";
    resetRateLimit(`password-reset-ip:${fixture.ip}`);
    for (let i = 0; i < 20; i++) {
      const email = `reset-${i}@fixture.invalid`;
      resetRateLimit(`password-reset-account:${fixture.ip}:${email}`);
      expect(await createPasswordResetToken(email)).toBeNull();
    }
    await expect(createPasswordResetToken("another@fixture.invalid")).rejects.toMatchObject({ status: 429 });
    expect(fixture.findUser).toHaveBeenCalledTimes(20);
  });
});
