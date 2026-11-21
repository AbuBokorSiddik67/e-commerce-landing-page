import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConflictError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ placeOrder: vi.fn(), submitReview: vi.fn(), processCallback: vi.fn() }));
vi.mock("@/services/orders", () => ({ placeOrder: mocks.placeOrder, processPaymentCallback: mocks.processCallback }));
vi.mock("@/services/reviews", () => ({ submitReview: mocks.submitReview }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "fixture-public-errors" }) }));

import { POST as order } from "@/app/api/orders/route";
import { POST as review } from "@/app/api/reviews/route";
import { POST as ipn } from "@/app/api/payments/[provider]/ipn/route";

const post = (body: string) => new Request("http://fixture.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body });
const payload = JSON.stringify({ fixture: true });
beforeEach(() => {
  mocks.placeOrder.mockReset();
  mocks.submitReview.mockReset();
  mocks.processCallback.mockReset();
});

describe("public endpoint error boundaries", () => {
  it("shows actionable conflicts but never exposes internal checkout errors", async () => {
    mocks.placeOrder.mockRejectedValueOnce(new ConflictError("Fixture product is out of stock"))
      .mockRejectedValueOnce(new Error("postgresql://fixture-secret@internal-host"));
    const conflict = await order(post(payload));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Fixture product is out of stock" });
    const error = await order(post(payload));
    expect(error.status).toBe(500);
    expect(JSON.stringify(await error.json())).not.toMatch(/fixture-secret|internal-host/);
  });

  it("returns a generic 400 for invalid JSON and validation errors", async () => {
    expect((await order(post("{"))).status).toBe(400);
    const invalid = z.object({ name: z.string() }).safeParse({});
    if (invalid.success) throw new Error("Invalid fixture unexpectedly parsed");
    mocks.placeOrder.mockRejectedValue(invalid.error);
    const result = await order(post(payload));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "Invalid order details" });
  });

  it("bounds IPN bodies and parses form fields without mistaking embedded braces for JSON", async () => {
    mocks.processCallback.mockResolvedValue({ ok: true });
    const context = { params: Promise.resolve({ provider: "fixture" }) };
    const oversized = await ipn(post(JSON.stringify({ data: "x".repeat(70_000) })), context);
    expect(oversized.status).toBe(413);
    expect(mocks.processCallback).not.toHaveBeenCalled();
    const form = new Request("http://fixture.invalid", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "tran_id=fixture&note=value{brace" });
    expect((await ipn(form, context)).status).toBe(200);
    expect(mocks.processCallback).toHaveBeenCalledWith("fixture", { tran_id: "fixture", note: "value{brace" });
    expect((await ipn(post("[]"), context)).status).toBe(400);
  });

  it("does not reflect database or provider secrets from review and IPN failures", async () => {
    mocks.submitReview.mockRejectedValue(new Error("fixture-database-secret"));
    const result = await review(post(payload));
    expect(result.status).toBe(500);
    expect(JSON.stringify(await result.json())).not.toContain("fixture-database-secret");
    mocks.processCallback.mockRejectedValue(new Error("fixture-provider-secret"));
    const callback = await ipn(post(payload), { params: Promise.resolve({ provider: "fixture" }) });
    expect(callback.status).toBe(400);
    expect(JSON.stringify(await callback.json())).not.toContain("fixture-provider-secret");
  });
});
