import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { getCourierProvider } from "@/lib/couriers/registry";
import { getCourierCredentialFromSnapshot } from "@/lib/settings";
import { lockOrder } from "./order-lock";
import { courierClaimMarkerSchema, courierConfigurationMac, courierEndpointOverride, lockedCourierConfiguration } from "./orders";

const reference = z.string().trim().min(1).max(512);
const evidence = z.string().trim().min(20).max(2000);
const bookingResolutionSchema = z.object({
  shipmentId: z.string().min(1), merchantReference: reference, consignmentId: reference, trackingId: reference,
  sandbox: z.boolean(), evidence, confirmOriginalAccount: z.literal(true),
});

/**
 * A staff-attested recovery of a known booking, not a provider API lookup.
 * Unknown absence is deliberately not cleared: a delayed request may still
 * create a shipment and the providers do not establish authoritative absence.
 */
export async function reconcileCourierBooking(raw: z.input<typeof bookingResolutionSchema>, actorId: string) {
  const input = bookingResolutionSchema.parse(raw);
  const pointer = await prisma.courierShipment.findUnique({ where: { id: input.shipmentId }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Courier shipment not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    const shipment = await tx.courierShipment.findUnique({ where: { id: input.shipmentId }, include: { order: true } });
    if (!shipment || shipment.orderId !== pointer.orderId) throw new NotFoundError("Courier shipment not found");
    const parsed = courierClaimMarkerSchema.safeParse(shipment.payload);
    if (!parsed.success || shipment.providerCode === "manual" || parsed.data.landiqBooking.merchantReference !== shipment.order.orderNumber
      || input.merchantReference !== shipment.order.orderNumber || parsed.data.landiqBooking.sandbox !== input.sandbox) {
      throw new ConflictError("Booking claim, original merchant reference or environment cannot be matched");
    }
    const payload = shipment.payload as Prisma.JsonObject;
    if (payload.conflictingProviderResult !== undefined || payload.additionalProviderResults !== undefined) {
      throw new ConflictError("Multiple provider results require individual reconciliation; do not select one automatically");
    }
    if (payload.landiqStaffRejection !== undefined) throw new ConflictError("Staff-reported rejection conflicts with a booking report, or its evidence is malformed; investigate both before resolving");
    if ((shipment.consignmentId && shipment.consignmentId !== input.consignmentId)
      || (shipment.trackingId && shipment.trackingId !== input.trackingId)) {
      throw new ConflictError("The reported references conflict with saved provider evidence");
    }
    if (shipment.status === "BOOKED" && parsed.data.landiqBooking.state === "BOOKED") {
      if (shipment.consignmentId === input.consignmentId && shipment.trackingId === input.trackingId) return shipment;
      throw new ConflictError("This booking was already resolved with different references");
    }
    if (shipment.status !== "PENDING" || !["AWAITING_RESULT", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(parsed.data.landiqBooking.state)) {
      throw new ConflictError("This courier claim is not awaiting booking reconciliation");
    }
    if (await tx.courierShipment.findFirst({ where: { orderId: shipment.orderId, id: { not: shipment.id } }, select: { id: true } })) {
      throw new ConflictError("Multiple courier records require separate investigation");
    }
    const updated = await tx.courierShipment.update({ where: { id: shipment.id }, data: {
      status: "BOOKED", consignmentId: input.consignmentId, trackingId: input.trackingId,
      payload: { ...payload, landiqBooking: { ...parsed.data.landiqBooking, state: "BOOKED" },
        landiqStaffResolution: { kind: "BOOKING_RECORDED", actorId, at: new Date().toISOString() } } as Prisma.InputJsonObject,
    } });
    await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: "BOOKED", source: "STAFF_RECONCILIATION",
      description: "Staff recorded a booking after checking the original provider account; physical possession is not established.",
      raw: { merchantReference: input.merchantReference, evidence: input.evidence, sandbox: input.sandbox } } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_BOOKING_STAFF_RECORDED", entity: "CourierShipment", entityId: shipment.id,
      after: { orderId: shipment.orderId, consignmentId: input.consignmentId, trackingId: input.trackingId, evidence: input.evidence } } });
    return updated;
  });
}

const bookingRejectionSchema = z.object({
  shipmentId: z.string().min(1), merchantReference: reference, sandbox: z.boolean(), evidence,
  confirmOriginalAccount: z.literal(true), confirmDefinitiveRejection: z.literal(true),
});

/**
 * Record a human report of a request-specific definitive rejection without
 * pretending we can verify the provider contract. Neither this report nor an
 * empty lookup clears the claim, permits another booking, or credits inventory.
 */
export async function recordCourierRejectionEvidence(raw: z.input<typeof bookingRejectionSchema>, actorId: string) {
  const input = bookingRejectionSchema.parse(raw);
  const pointer = await prisma.courierShipment.findUnique({ where: { id: input.shipmentId }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Courier shipment not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    const shipment = await tx.courierShipment.findUnique({ where: { id: input.shipmentId }, include: { order: true } });
    if (!shipment || shipment.orderId !== pointer.orderId) throw new NotFoundError("Courier shipment not found");
    const marker = courierClaimMarkerSchema.safeParse(shipment.payload);
    if (!marker.success || shipment.providerCode === "manual" || shipment.status !== "PENDING"
      || !["AWAITING_RESULT", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(marker.data.landiqBooking.state)
      || marker.data.landiqBooking.merchantReference !== shipment.order.orderNumber
      || input.merchantReference !== shipment.order.orderNumber || marker.data.landiqBooking.sandbox !== input.sandbox) {
      throw new ConflictError("Unresolved booking, original merchant reference or environment cannot be matched");
    }
    const payload = shipment.payload as Prisma.JsonObject;
    if (shipment.consignmentId || shipment.trackingId || payload.conflictingProviderResult !== undefined || payload.additionalProviderResults !== undefined
      || await tx.courierShipment.findFirst({ where: { orderId: shipment.orderId, id: { not: shipment.id } }, select: { id: true } })) {
      throw new ConflictError("A booking reference or conflicting result already exists; investigate rather than recording rejection as fact");
    }
    const previous = z.object({ kind: z.literal("STAFF_REPORTED_REJECTION"), evidence: z.string() }).safeParse(payload.landiqStaffRejection);
    if (payload.landiqStaffRejection !== undefined) {
      if (previous.success && previous.data.evidence === input.evidence) return shipment;
      throw new ConflictError("A rejection report already exists or is malformed; investigate the evidence before changing it");
    }
    const updated = await tx.courierShipment.update({ where: { id: shipment.id }, data: {
      // Keep the claim state and PENDING status: the original call may still be in flight.
      payload: { ...payload, landiqStaffRejection: { kind: "STAFF_REPORTED_REJECTION", evidence: input.evidence,
        actorId, at: new Date().toISOString() } } as Prisma.InputJsonObject,
    } });
    await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id, status: "PENDING", source: "STAFF_RECONCILIATION",
      description: "Staff reported a definitive rejection for this request; it is not independently verified and the claim remains blocked.",
      raw: { merchantReference: input.merchantReference, evidence: input.evidence, sandbox: input.sandbox } } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_REJECTION_STAFF_REPORTED", entity: "CourierShipment", entityId: shipment.id,
      after: { orderId: shipment.orderId, evidence: input.evidence, sandbox: input.sandbox } } });
    return updated;
  });
}

type CancellationResult = "RECONCILIATION_REQUIRED" | "OUTCOME_UNKNOWN";

async function recordCancellationResult(orderId: string, operationId: string, actorId: string,
  status: CancellationResult, reported: boolean | null) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const operation = await tx.courierOperation.findUniqueOrThrow({ where: { id: operationId }, include: { shipment: true } });
    if (operation.shipment.orderId !== orderId || operation.kind !== "CANCEL") throw new ConflictError("Courier operation changed");
    if (operation.status !== "AWAITING_RESULT" && operation.status !== "RECONCILED") return operation;
    // If a human resolved an apparently crashed operation while its original
    // response was still in flight, retain that late report and reopen review.
    const late = operation.status === "RECONCILED";
    const updated = await tx.courierOperation.update({ where: { id: operation.id }, data: {
      status: late ? "RECONCILIATION_REQUIRED" : status,
      ...(late ? {} : { outcome: reported === null ? null : `PROVIDER_REPORTED_${reported ? "TRUE" : "FALSE"}` }),
    } });
    await tx.courierTrackingEvent.create({ data: { shipmentId: operation.shipmentId, status: operation.shipment.status, source: "SYSTEM",
      description: late ? "A late cancellation response arrived after staff reconciliation; review again."
        : "Courier cancellation outcome needs reconciliation; this does not establish a physical return.",
      raw: { reported, late } } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_CANCELLATION_RESULT", entity: "CourierOperation", entityId: operation.id,
      after: { orderId, status: updated.status, reported, late } } });
    return updated;
  });
}

/** One durable cancellation claim per shipment. No database lock spans the provider call. */
export async function requestCourierCancellation(shipmentId: string, actorId: string) {
  const pointer = await prisma.courierShipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
  if (!pointer) throw new NotFoundError("Courier shipment not found");
  const previous = await prisma.courierOperation.findUnique({ where: { shipmentId_kind: { shipmentId, kind: "CANCEL" } } });
  if (previous) return previous; // An unknown write is never sent again.
  const provider = getCourierProvider(pointer.providerCode);
  if (!provider?.cancelShipment) throw new ConflictError("This provider has no cancellation adapter; contact it and record the outcome manually");
  const config = await prisma.courierProviderConfiguration.findUnique({ where: { code: pointer.providerCode } });
  if (!config?.enabled) throw new ConflictError("Courier provider is disabled; reconcile cancellation manually");
  const credentials = await getCourierCredentialFromSnapshot(pointer.providerCode, config.credentials);
  if (!provider.credentialsValid(credentials)) throw new ConflictError("Courier credentials are not configured");
  const endpoint = courierEndpointOverride(pointer.providerCode);
  const mac = courierConfigurationMac(config, credentials, endpoint);

  const start = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    const prior = await tx.courierOperation.findUnique({ where: { shipmentId_kind: { shipmentId, kind: "CANCEL" } } });
    if (prior) return { kind: "existing" as const, operation: prior };
    const shipment = await tx.courierShipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!shipment || shipment.orderId !== pointer.orderId) throw new NotFoundError("Courier shipment not found");
    const marker = courierClaimMarkerSchema.safeParse(shipment.payload);
    const referenceValue = shipment.consignmentId || shipment.trackingId;
    if (shipment.order.status !== "CANCELLED" || !referenceValue || !marker.success
      || marker.data.landiqBooking.state !== "BOOKED" || marker.data.landiqBooking.merchantReference !== shipment.order.orderNumber
      || marker.data.landiqBooking.sandbox !== config.sandbox || marker.data.landiqBooking.configurationMac !== mac
      || ["PENDING", "CANCELLED", "DELIVERED"].includes(shipment.status)) {
      throw new ConflictError("Cancel the order and reconcile the original booking/account before requesting courier cancellation");
    }
    const current = await lockedCourierConfiguration(tx, shipment.providerCode);
    if (!current?.enabled || courierConfigurationMac(current,
      await getCourierCredentialFromSnapshot(shipment.providerCode, current.credentials), endpoint) !== mac) {
      throw new ConflictError("Courier account or endpoint changed; reconcile before cancellation");
    }
    const operation = await tx.courierOperation.create({ data: {
      id: `courier_cancel_${randomUUID()}`, shipmentId, kind: "CANCEL", status: "AWAITING_RESULT", providerCode: shipment.providerCode,
      sandbox: config.sandbox, configurationMac: mac, externalReference: referenceValue, createdById: actorId,
    } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_CANCELLATION_CLAIMED", entity: "CourierOperation", entityId: operation.id,
      after: { orderId: shipment.orderId, shipmentId, providerCode: shipment.providerCode, sandbox: config.sandbox } } });
    return { kind: "claimed" as const, operation };
  });
  if (start.kind === "existing") return start.operation;
  let reported: boolean | null = null;
  try {
    // The adapter's boolean is a report, not independent cancellation or
    // warehouse-receipt proof. Persist it without automatically retrying.
    const result: unknown = await provider.cancelShipment(start.operation.externalReference, credentials, config.sandbox, endpoint);
    if (typeof result !== "boolean") throw new Error("Unrecognized cancellation response");
    reported = result;
    return await recordCancellationResult(pointer.orderId, start.operation.id, actorId, "RECONCILIATION_REQUIRED", reported);
  } catch (error) {
    try { await recordCancellationResult(pointer.orderId, start.operation.id, actorId,
      reported === null ? "OUTCOME_UNKNOWN" : "RECONCILIATION_REQUIRED", reported); }
    catch (recordError) { console.error("Could not annotate courier cancellation claim", { operationId: start.operation.id,
      errorType: recordError instanceof Error ? recordError.name : "UnknownError" }); }
    console.error("Courier cancellation requires reconciliation", { operationId: start.operation.id,
      errorType: error instanceof Error ? error.name : "UnknownError" });
    throw new ConflictError("Courier cancellation may have been sent. Do not retry; check the provider and reconcile it.");
  }
}

const cancellationResolutionSchema = z.object({
  shipmentId: z.string().min(1), outcome: z.enum(["CANCELLED", "NOT_CANCELLED"]), evidence,
  confirmOriginalAccount: z.literal(true),
});

// A late provider response may reopen a staff-reconciled cancellation. Retain
// the pre-cancellation local state, bound to the operation, so a later contrary
// report does not leave a falsely CANCELLED shipment or invent a new status.
const cancellationPriorSchema = z.object({ landiqCancellationPrior: z.object({
  version: z.literal(1), operationId: z.string(),
  shipmentStatus: z.enum(["PENDING", "BOOKED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"]),
}) });

/** Staff can record an independently checked outcome, including for manual/unsupported couriers. */
export async function reconcileCourierCancellation(raw: z.input<typeof cancellationResolutionSchema>, actorId: string) {
  const input = cancellationResolutionSchema.parse(raw);
  const pointer = await prisma.courierShipment.findUnique({ where: { id: input.shipmentId }, select: { orderId: true } });
  if (!pointer) throw new NotFoundError("Courier shipment not found");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, pointer.orderId);
    const shipment = await tx.courierShipment.findUnique({ where: { id: input.shipmentId }, include: { order: true } });
    if (!shipment || shipment.orderId !== pointer.orderId) throw new NotFoundError("Courier shipment not found");
    if (shipment.order.status !== "CANCELLED") throw new ConflictError("Record order cancellation first");
    const marker = courierClaimMarkerSchema.safeParse(shipment.payload);
    const externalReference = shipment.consignmentId || shipment.trackingId;
    if (shipment.providerCode !== "manual" && (!marker.success || marker.data.landiqBooking.state !== "BOOKED"
      || marker.data.landiqBooking.merchantReference !== shipment.order.orderNumber || !externalReference)) {
      throw new ConflictError("Reconcile the original booking and reference before recording cancellation");
    }
    const existing = await tx.courierOperation.findUnique({ where: { shipmentId_kind: { shipmentId: shipment.id, kind: "CANCEL" } } });
    const outcome = `STAFF_REPORTED_${input.outcome}`;
    if (existing?.status === "RECONCILED") {
      if (existing.outcome === outcome && existing.evidence === input.evidence) return existing;
      throw new ConflictError("This cancellation was already reconciled with different evidence");
    }
    let shipmentStatusAfter = shipment.status;
    const payload = shipment.payload && typeof shipment.payload === "object" && !Array.isArray(shipment.payload)
      ? shipment.payload as Prisma.JsonObject : null;
    if (input.outcome === "CANCELLED" && shipment.status !== "CANCELLED" && !payload) {
      throw new ConflictError("Shipment history is malformed; review before recording cancellation");
    }
    if (input.outcome === "NOT_CANCELLED" && shipment.status === "CANCELLED") {
      const prior = cancellationPriorSchema.safeParse(shipment.payload);
      if (!existing || !prior.success || prior.data.landiqCancellationPrior.operationId !== existing.id) {
        throw new ConflictError("The previous shipment status is unknown; keep this cancellation under review");
      }
      shipmentStatusAfter = prior.data.landiqCancellationPrior.shipmentStatus;
    }
    const operation = existing
      ? await tx.courierOperation.update({ where: { id: existing.id }, data: { status: "RECONCILED", outcome, evidence: input.evidence } })
      : await tx.courierOperation.create({ data: { shipmentId: shipment.id, kind: "CANCEL", status: "RECONCILED", outcome,
        evidence: input.evidence, providerCode: shipment.providerCode, sandbox: marker.success ? marker.data.landiqBooking.sandbox : false,
        configurationMac: marker.success ? marker.data.landiqBooking.configurationMac : "manual",
        externalReference: externalReference ?? "manual", createdById: actorId } });
    if (input.outcome === "CANCELLED" && shipment.status !== "CANCELLED") {
      shipmentStatusAfter = "CANCELLED";
      await tx.courierShipment.update({ where: { id: shipment.id }, data: { status: shipmentStatusAfter,
        payload: { ...payload!, landiqCancellationPrior: { version: 1, operationId: operation.id,
          shipmentStatus: shipment.status } } as Prisma.InputJsonObject } });
    } else if (shipmentStatusAfter !== shipment.status) {
      await tx.courierShipment.update({ where: { id: shipment.id }, data: { status: shipmentStatusAfter } });
    }
    await tx.courierTrackingEvent.create({ data: { shipmentId: shipment.id,
      status: shipmentStatusAfter, source: "STAFF_RECONCILIATION",
      description: input.outcome === "NOT_CANCELLED" && shipment.status === "CANCELLED"
        ? "Staff reported the courier was not cancelled; the prior local status was restored and may be stale. Warehouse receipt is still separate."
        : `Staff reported courier ${input.outcome.toLowerCase().replace("_", " ")}; warehouse receipt is still separate.`,
      raw: { evidence: input.evidence, outcome: input.outcome } } });
    await tx.auditLog.create({ data: { actorId, action: "COURIER_CANCELLATION_STAFF_RECORDED", entity: "CourierOperation", entityId: operation.id,
      after: { orderId: shipment.orderId, outcome, evidence: input.evidence } } });
    return operation;
  });
}
