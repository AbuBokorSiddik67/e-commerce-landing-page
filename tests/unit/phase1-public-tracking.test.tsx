import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getOrder: vi.fn(), rateLimit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/services/orders", () => ({ getOrderByTrackingToken: mocks.getOrder, STATUS_LABELS: { PENDING: "Pending" } }));

import TrackPage from "@/app/track/[token]/page";

beforeEach(() => { vi.clearAllMocks(); });

function order(providerCode: string, status: string) {
  return { orderNumber: "ORD-1", createdAt: new Date("2026-01-01"), status: "PENDING", total: 100,
    paymentMethod: "cod", deliveryOption: "inside_city", customer: { name: "Buyer", phone: "01700000000" },
    district: "Rajshahi", area: null, items: [{ name: "Item", quantity: 1 }], statusHistory: [],
    expectedDeliveryAt: null, shipments: [{ providerCode, status, trackingId: null, trackingUrl: null, payload: {} }] };
}

describe("public tracking labels", () => {
  it.each(["PENDING", "BOOKED"])("does not call a %s provider record verified", async (status) => {
    mocks.getOrder.mockResolvedValue(order("pathao", status));
    const html = renderToStaticMarkup(await TrackPage({ params: Promise.resolve({ token: "fixture-token" }) }));
    expect(html).toContain("(provider record)");
    expect(html).not.toContain("verified provider update");
  });

  it("identifies a manual courier record without suggesting provider verification", async () => {
    mocks.getOrder.mockResolvedValue(order("manual", "BOOKED"));
    const html = renderToStaticMarkup(await TrackPage({ params: Promise.resolve({ token: "fixture-token" }) }));
    expect(html).toContain("(manual update)");
    expect(html).not.toContain("verified provider update");
  });
});
