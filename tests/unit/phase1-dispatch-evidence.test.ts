import { describe, expect, it, vi } from "vitest";
import { hasConflictingDispatchEvidence } from "@/services/order-lock";

// In-memory query doubles exercise the historical-evidence predicate only;
// they do not verify PostgreSQL transaction or lock behavior.
function fixture() {
  const tx = {
    orderStatusHistory: { findFirst: vi.fn().mockResolvedValue(null) },
    ownDelivery: { findUnique: vi.fn().mockResolvedValue({ id: "delivery" }) },
    ownDeliveryEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    returnRequest: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const order = { id: "order", status: "READY_TO_SHIP" as const, shippedAt: null, deliveredAt: null, cancelledAt: null };
  return { tx, order, check: () => hasConflictingDispatchEvidence(tx as unknown as Parameters<typeof hasConflictingDispatchEvidence>[0], order) };
}

describe("conflicting dispatch evidence", () => {
  it("detects prior shop dispatch even when the current assignment looks undispatched", async () => {
    const { tx, check } = fixture();
    tx.ownDeliveryEvent.findFirst.mockResolvedValue({ id: "prior-event" });
    expect(await check()).toBe(true);
    expect(tx.ownDeliveryEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: { in: expect.arrayContaining(["DISPATCHED", "FAILED", "DELIVERED", "RETURNING", "RETURNED"]) },
    }) }));
  });

  it("detects an earlier order dispatch or return request", async () => {
    const first = fixture();
    first.tx.orderStatusHistory.findFirst.mockResolvedValue({ id: "shipped-history" });
    expect(await first.check()).toBe(true);
    const second = fixture();
    second.tx.returnRequest.findFirst.mockResolvedValue({ id: "historic-return" });
    expect(await second.check()).toBe(true);
  });

  it("does not invent conflicting history when no evidence exists", async () => {
    expect(await fixture().check()).toBe(false);
  });
});
