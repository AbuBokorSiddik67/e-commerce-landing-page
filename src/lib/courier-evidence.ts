type ShipmentEvidence = { providerCode: string; status: string; payload: unknown; consignmentId: string | null; trackingId: string | null };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** UI labels describe the provenance of a report, not physical custody or verified provider contracts. */
export function courierEvidenceLabel(shipment: ShipmentEvidence) {
  if (shipment.providerCode === "manual") return "Manual shipment entry (staff-provided; not verified)";
  const payload = object(shipment.payload);
  const marker = object(payload?.landiqBooking);
  const staff = object(payload?.landiqStaffResolution);
  const rejection = object(payload?.landiqStaffRejection);
  if (payload?.conflictingProviderResult !== undefined || payload?.additionalProviderResults !== undefined
    || (rejection && (shipment.consignmentId || shipment.trackingId))) {
    return "Conflicting booking evidence — investigate every reported result";
  }
  if (rejection?.kind === "STAFF_REPORTED_REJECTION") {
    return "Staff reports a request-specific rejection — not independently verified; claim remains blocked";
  }
  if (payload?.landiqStaffRejection !== undefined) return "Malformed rejection evidence — review required; claim remains blocked";
  if (marker?.version !== 4 || typeof marker.state !== "string") return "Legacy or malformed claim — review required";
  if (marker.state === "BOOKED" && staff?.kind === "BOOKING_RECORDED") {
    return "Staff-recorded shipment reference — evidence supplied, not independently verified";
  }
  if (marker.state === "BOOKED") return "Provider-reported booking — adapter response recorded, not independently verified";
  if (marker.state === "AWAITING_RESULT") return "Booking request in flight or interrupted — outcome unknown";
  if (marker.state === "OUTCOME_UNKNOWN") return "Booking outcome unknown — do not retry";
  if (marker.state === "RECONCILIATION_REQUIRED") return "Booking requires reconciliation — do not retry";
  return "Unrecognized claim state — review required";
}

export function staffCourierEvidence(raw: unknown) {
  const value = object(raw)?.evidence;
  return typeof value === "string" ? value : null;
}

export function conflictingCourierReferences(payload: unknown) {
  const record = object(payload);
  const additional = Array.isArray(record?.additionalProviderResults) ? record.additionalProviderResults : [];
  return [record?.conflictingProviderResult, ...additional].map(object).filter((value): value is Record<string, unknown> => Boolean(value))
    .map((conflict) => ({
      consignment: typeof conflict.consignmentId === "string" ? conflict.consignmentId : "—",
      tracking: typeof conflict.trackingId === "string" ? conflict.trackingId : "—",
    }));
}
