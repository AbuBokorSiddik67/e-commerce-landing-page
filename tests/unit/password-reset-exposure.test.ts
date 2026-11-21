import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createToken: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/auth", () => ({ createPasswordResetToken: mocks.createToken }));
vi.mock("@/lib/notifications", () => ({ sendTransactionalEmail: mocks.sendEmail }));
vi.mock("@/lib/config", () => ({ siteUrl: () => "http://fixture.invalid" }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { requestResetAction } from "@/app/actions/auth";

const generic = { message: "If that account exists and email is configured, a reset link will be sent." };
function form() {
  const input = new FormData();
  input.set("email", "owner@fixture.invalid");
  return input;
}

beforeEach(() => {
  mocks.createToken.mockReset().mockResolvedValue("fixture-secret-token");
  mocks.sendEmail.mockReset().mockResolvedValue({ status: "SKIPPED" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("password reset capability exposure", () => {
  it("does not return reset links by default in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LANDIQ_SHOW_DEV_RESET_LINK", "");
    expect(await requestResetAction(undefined, form())).toEqual(generic);
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("shows the link only with an explicit development opt-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LANDIQ_SHOW_DEV_RESET_LINK", "1");
    expect(await requestResetAction(undefined, form())).toEqual({
      message: "Development only: reset link /reset-password?token=fixture-secret-token",
    });
    mocks.createToken.mockResolvedValue(null);
    expect(await requestResetAction(undefined, form())).toEqual(generic);
  });

  it("never returns the link in production even if the flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANDIQ_SHOW_DEV_RESET_LINK", "1");
    expect(await requestResetAction(undefined, form())).toEqual(generic);
  });
});
