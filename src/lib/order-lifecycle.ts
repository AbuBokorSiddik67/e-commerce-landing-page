import type { OrderStatus, OwnDeliveryStatus, ReturnStatus, ShipmentStatus } from "@prisma/client";

// Cancellation and returns are intentionally absent: they have dedicated,
// inventory-aware transactions and may never be set by the generic status form.
export const MANUAL_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED"],
  CONFIRMED: ["PROCESSING", "READY_TO_SHIP"],
  PROCESSING: ["READY_TO_SHIP", "SHIPPED"],
  READY_TO_SHIP: ["SHIPPED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY"],
  DELIVERED: [],
  CANCELLED: [],
  RETURNED: [],
};

// Status changes do not themselves credit inventory. Each physical receipt
// must be inspected once before RESTOCKED or completion is permitted.
export const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["IN_TRANSIT", "INSPECTED", "REJECTED"],
  IN_TRANSIT: ["INSPECTED", "REJECTED"],
  INSPECTED: ["RESTOCKED", "REFUNDED", "COMPLETED", "REJECTED"],
  RESTOCKED: ["REFUNDED", "COMPLETED"],
  REFUNDED: ["COMPLETED"],
  COMPLETED: [],
  REJECTED: [],
};

export const CANCELLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP",
];

export const RETURNABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "CANCELLED",
];

// A delivery outcome is physical history and may continue after an order has
// been cancelled. RETURNED here means the courier reports a return, not that
// the warehouse has received or inspected any units.
export const OWN_DELIVERY_TRANSITIONS: Record<OwnDeliveryStatus, readonly OwnDeliveryStatus[]> = {
  ASSIGNED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["OUT_FOR_DELIVERY", "FAILED", "DELIVERED", "RETURNING"],
  OUT_FOR_DELIVERY: ["FAILED", "DELIVERED", "RETURNING"],
  FAILED: ["OUT_FOR_DELIVERY", "RETURNING"],
  DELIVERED: ["RETURNING"],
  RETURNING: ["RETURNED"],
  RETURNED: [],
  CANCELLED: [],
};

// A courier request can create an external shipment. Only start it before the
// order is shipped, after the order has been confirmed and allocated.
export const COURIER_BOOKING_ORDER_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED", "PROCESSING", "READY_TO_SHIP",
];

// Old FAILED/CANCELLED rows are not proof that an external parcel is safe to
// restock. PENDING includes in-flight, crashed and unknown-outcome claims.
export const UNRESOLVED_COURIER_STATUSES: readonly ShipmentStatus[] = [
  "PENDING", "FAILED", "CANCELLED",
];
