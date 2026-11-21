import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: new Set<string>(), requirePermission: vi.fn(), assign: vi.fn(), event: vi.fn(),
  reconcileBooking: vi.fn(), requestCancellation: vi.fn(), reconcileCancellation: vi.fn(), receive: vi.fn(), inspect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: state.requirePermission }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`TEST_REDIRECT:${url}`); } }));
vi.mock("@/services/own-delivery", () => ({ assignOwnDelivery: state.assign, recordOwnDeliveryEvent: state.event }));
vi.mock("@/services/courier-operations", () => ({ reconcileCourierBooking: state.reconcileBooking,
  requestCourierCancellation: state.requestCancellation, reconcileCourierCancellation: state.reconcileCancellation }));
vi.mock("@/services/orders", () => ({}));
vi.mock("@/services/returns", () => ({ receiveReturnItems: state.receive, inspectReturnReceipt: state.inspect }));
vi.mock("@/services/coupons", () => ({}));
vi.mock("@/services/reviews", () => ({}));
vi.mock("@/services/customers", () => ({}));
vi.mock("@/services/media", () => ({}));

import { assignOwnDeliveryAction, ownDeliveryEventAction, reconcileCourierBookingAction, reconcileCourierCancellationAction,
  requestCourierCancellationAction } from "@/app/actions/orders";
import { inspectReturnAction, receiveReturnAction } from "@/app/actions/catalog";

function form() {
  const data = new FormData();
  data.set("id", "order-1"); data.set("orderId", "order-1"); data.set("personId", "driver"); data.set("status", "DISPATCHED");
  data.set("shipmentId", "shipment-1"); data.set("returnRequestId", "return-1"); data.set("receiptId", "receipt-1");
  data.set("orderItemId", "item-1"); data.set("quantity", "2"); data.set("sellableQuantity", "1"); data.set("damagedQuantity", "1");
  data.set("idempotencyKey", "40000000-0000-4000-8000-000000000001");
  data.set("merchantReference", "ORD-1"); data.set("consignmentId", "c-1"); data.set("trackingId", "t-1");
  data.set("environment", "sandbox"); data.set("evidence", "Checked original provider support case 12345");
  data.set("outcome", "CANCELLED"); data.set("confirmOriginalAccount", "on");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks(); state.allowed = new Set();
  state.requirePermission.mockImplementation(async (permission: string) => {
    if (!state.allowed.has(permission)) throw new Error(`DENIED:${permission}`);
    return { id: "actor-1" };
  });
});

describe("Phase 1 new action authorization", () => {
  it("denies direct calls to shop delivery and courier operations without orders.write", async () => {
    const actions = [assignOwnDeliveryAction, ownDeliveryEventAction, reconcileCourierBookingAction,
      requestCourierCancellationAction, reconcileCourierCancellationAction, receiveReturnAction, inspectReturnAction];
    for (const action of actions) await expect(action(form())).rejects.toThrow("DENIED:orders.write");
    for (const call of [state.assign, state.event, state.reconcileBooking, state.requestCancellation,
      state.reconcileCancellation, state.receive, state.inspect]) expect(call).not.toHaveBeenCalled();
  });

  it("requires inventory.write as well as orders.write for receipt and inspection", async () => {
    state.allowed.add("orders.write");
    await expect(receiveReturnAction(form())).rejects.toThrow("DENIED:inventory.write");
    await expect(inspectReturnAction(form())).rejects.toThrow("DENIED:inventory.write");
    expect(state.receive).not.toHaveBeenCalled(); expect(state.inspect).not.toHaveBeenCalled();
  });

  it("does not call booking reconciliation without explicit original-account confirmation", async () => {
    state.allowed.add("orders.write");
    const input = form(); input.delete("confirmOriginalAccount");
    await expect(reconcileCourierBookingAction(input)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    expect(state.reconcileBooking).not.toHaveBeenCalled();
  });

  it("passes independently selected environment and confirmation to the service", async () => {
    state.allowed.add("orders.write");
    await expect(reconcileCourierBookingAction(form())).rejects.toThrow(/TEST_REDIRECT:.*success=/);
    expect(state.reconcileBooking).toHaveBeenCalledWith(expect.objectContaining({ sandbox: true, confirmOriginalAccount: true,
      merchantReference: "ORD-1", shipmentId: "shipment-1" }), "actor-1");
  });

  it("rejects missing or malformed inspection quantities rather than silently assuming zero", async () => {
    state.allowed.add("orders.write"); state.allowed.add("inventory.write");
    const missing = form(); missing.delete("damagedQuantity");
    await expect(inspectReturnAction(missing)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    const malformed = form(); malformed.set("damagedQuantity", "not-a-number");
    await expect(inspectReturnAction(malformed)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    expect(state.inspect).not.toHaveBeenCalled();
  });

  it("submits a properly authorized physical receipt with its stable operation key", async () => {
    state.allowed.add("orders.write"); state.allowed.add("inventory.write");
    await expect(receiveReturnAction(form())).rejects.toThrow(/TEST_REDIRECT:.*success=/);
    expect(state.receive).toHaveBeenCalledWith({ returnRequestId: "return-1", orderItemId: "item-1", quantity: 2,
      idempotencyKey: "40000000-0000-4000-8000-000000000001" }, "actor-1");
  });
});
