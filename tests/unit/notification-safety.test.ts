import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), logs: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mocks.sendMail }) } }));
vi.mock("@/lib/config", () => ({ env: () => ({
  SMTP_HOST: "smtp.fixture.invalid", SMTP_PORT: 587, SMTP_USER: "fixture", SMTP_PASSWORD: "fixture-secret",
  SMTP_FROM: "sender@fixture.invalid", SMS_API_URL: "https://sms.fixture.invalid", SMS_API_TOKEN: "fixture-secret",
}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  setting: { findUnique: vi.fn(async () => ({ value: { enabled: true } })) },
  notification: { create: vi.fn(async () => ({ id: "notification-fixture" })) },
  notificationLog: { create: mocks.logs },
} }));

import { notify, sendTransactionalEmail } from "@/lib/notifications";

beforeEach(() => { vi.clearAllMocks(); mocks.logs.mockResolvedValue({}); });
afterEach(() => vi.unstubAllGlobals());

describe("notification provider boundaries", () => {
  it("records acceptance without persisting arbitrary SMTP or SMS response bodies", async () => {
    mocks.sendMail.mockResolvedValue({ messageId: "fixture-secret@example.invalid" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("fixture-secret; customer phone and message", { status: 202 })));
    await notify({ type: "FIXTURE", title: "Fixture", body: "Synthetic message", email: "buyer@fixture.invalid",
      phone: "01700000000", channels: ["EMAIL", "SMS"] });
    expect(mocks.logs).toHaveBeenCalledTimes(2);
    expect(mocks.logs.mock.calls[0][0].data).toMatchObject({ status: "SENT", response: "SMTP server accepted message" });
    expect(mocks.logs.mock.calls[1][0].data).toMatchObject({ status: "ACCEPTED", response: "Gateway accepted request (HTTP 202)" });
    expect(JSON.stringify(mocks.logs.mock.calls)).not.toContain("fixture-secret");
  });

  it("keeps provider errors and addresses out of failure responses and logs", async () => {
    mocks.sendMail.mockRejectedValue(new Error("SMTP fixture-secret to buyer@fixture.invalid"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("fixture-secret; 01700000000", { status: 401 })));
    const result = await sendTransactionalEmail("buyer@fixture.invalid", "Fixture", "Synthetic");
    expect(result).toMatchObject({ status: "FAILED", error: "Email delivery failed" });
    await notify({ type: "FIXTURE", title: "Fixture", body: "Synthetic message", email: "buyer@fixture.invalid",
      phone: "01700000000", channels: ["EMAIL", "SMS"] });
    expect(mocks.logs.mock.calls[0][0].data.error).toBe("Email delivery failed");
    expect(mocks.logs.mock.calls[1][0].data.error).toBe("SMS gateway HTTP 401");
    expect(JSON.stringify(mocks.logs.mock.calls)).not.toContain("fixture-secret");
    expect(JSON.stringify(mocks.logs.mock.calls)).not.toContain("01700000000");
  });

  it("hides gateway URL and token on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("https://sms.fixture.invalid?token=fixture-secret")));
    await notify({ type: "FIXTURE", title: "Fixture", body: "Synthetic", phone: "01700000000", channels: ["SMS"] });
    expect(mocks.logs.mock.calls[0][0].data.error).toBe("SMS delivery failed");
    expect(JSON.stringify(mocks.logs.mock.calls)).not.toContain("fixture-secret");
  });
});
