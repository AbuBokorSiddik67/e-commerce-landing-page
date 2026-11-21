import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), callback: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findUnique: mocks.findUnique } } }));
vi.mock("@/components/public/PaymentReturn", () => ({ PaymentReturn: () => null }));
vi.mock("@/services/orders", () => ({ processPaymentCallback: mocks.callback }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

import OrderConfirmed from "@/app/order-confirmed/page";
import { POST as paymentCallback } from "@/app/api/payments/[provider]/callback/route";

const token = "A".repeat(32);
const record = { orderNumber: "ORD-1", total: 420, paymentMethod: "fixture", paymentStatus: "PENDING" };
beforeEach(() => { vi.clearAllMocks(); mocks.findUnique.mockResolvedValue(record); });

async function render(params: { order?: string; token?: string; payment?: string }) {
  return renderToStaticMarkup(await OrderConfirmed({ searchParams: Promise.resolve(params) }));
}

describe("private order confirmation", () => {
  it("does not look up or reveal details using only an order number or spoofed payment flag", async () => {
    const html = await render({ order: "ORD-1", payment: "verified" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(html).toContain("Order confirmation unavailable");
    expect(html).not.toContain("420");
  });

  it("requires the token to match the optional order number", async () => {
    const html = await render({ order: "ORD-WRONG", token });
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { trackingToken: token } }));
    expect(html).toContain("Order confirmation unavailable");
    expect(html).not.toContain("420");
  });

  it("uses stored payment status, not the query flag", async () => {
    const pending = await render({ order: "ORD-1", token, payment: "verified" });
    expect(pending).toContain("Payment is not verified");
    mocks.findUnique.mockResolvedValue({ ...record, paymentStatus: "PAID" });
    const paid = await render({ order: "ORD-1", token, payment: "failed" });
    expect(paid).not.toContain("Payment is not verified");
    expect(paid).toContain("420");
  });

  it("does not expose provider error details in a failed callback redirect", async () => {
    mocks.callback.mockRejectedValue(new Error("secret-provider-payload"));
    const response = await paymentCallback(new Request("http://fixture.invalid/api/payments/fixture/callback", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ provider: "fixture" }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).not.toContain("secret-provider-payload");
    expect(new URL(response.headers.get("location")!).pathname).toBe("/checkout/failed");
  });

  it("returns a POST callback as a GET redirect without handing out a tracking token", async () => {
    mocks.callback.mockResolvedValue({ ok: true, orderNumber: "ORD-1" });
    const response = await paymentCallback(new Request("http://fixture.invalid/api/payments/fixture/callback", {
      method: "POST", body: JSON.stringify({ reference: "synthetic" }), headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ provider: "fixture" }) });
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/order-confirmed");
    expect(location.searchParams.get("order")).toBe("ORD-1");
    expect(location.searchParams.has("token")).toBe(false);
    expect(location.searchParams.has("payment")).toBe(false);
  });
});
