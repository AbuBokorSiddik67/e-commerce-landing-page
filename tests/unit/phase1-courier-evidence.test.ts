import { describe, expect, it } from "vitest";
import { conflictingCourierReferences, courierEvidenceLabel, staffCourierEvidence } from "@/lib/courier-evidence";

const marker = { version: 4, state: "BOOKED" };
const shipment = { providerCode: "fixture", status: "BOOKED", consignmentId: "c1", trackingId: "t1", payload: { landiqBooking: marker } };

describe("courier evidence labels", () => {
  it("distinguishes provider, staff-recorded and manual references without claiming independent verification", () => {
    expect(courierEvidenceLabel(shipment)).toMatch(/Provider-reported booking.*not independently verified/);
    expect(courierEvidenceLabel({ ...shipment, payload: { landiqBooking: marker, landiqStaffResolution: { kind: "BOOKING_RECORDED" } } })).toMatch(/Staff-recorded shipment reference/);
    expect(courierEvidenceLabel({ ...shipment, providerCode: "manual" })).toMatch(/Manual shipment entry/);
    expect(staffCourierEvidence({ evidence: "Provider case 12345" })).toBe("Provider case 12345");
    expect(staffCourierEvidence({ evidence: { token: "not-displayable" } })).toBeNull();
  });

  it("distinguishes unknown, staff-reported rejection, and conflicting outcomes without clearing claims", () => {
    const unresolved = { ...shipment, status: "PENDING", consignmentId: null, trackingId: null };
    expect(courierEvidenceLabel({ ...unresolved, payload: { landiqBooking: { ...marker, state: "OUTCOME_UNKNOWN" } } })).toMatch(/outcome unknown/i);
    const rejected = { landiqBooking: { ...marker, state: "OUTCOME_UNKNOWN" }, landiqStaffRejection: { kind: "STAFF_REPORTED_REJECTION" } };
    expect(courierEvidenceLabel({ ...unresolved, payload: rejected })).toMatch(/reports a request-specific rejection.*not independently verified.*blocked/);
    const conflicted = { ...rejected, conflictingProviderResult: { consignmentId: "c2", trackingId: "t2" } };
    expect(courierEvidenceLabel({ ...unresolved, payload: conflicted })).toMatch(/Conflicting booking evidence/);
    expect(conflictingCourierReferences({ ...conflicted, additionalProviderResults: [{ consignmentId: "c3", trackingId: "t3" }, null] }))
      .toEqual([{ consignment: "c2", tracking: "t2" }, { consignment: "c3", tracking: "t3" }]);
    expect(courierEvidenceLabel({ ...unresolved, payload: { landiqBooking: marker, additionalProviderResults: [{ trackingId: "t3" }] } })).toMatch(/Conflicting booking evidence/);
    expect(courierEvidenceLabel({ ...unresolved, payload: { landiqBooking: marker, conflictingProviderResult: null } })).toMatch(/Conflicting booking evidence/);
    expect(courierEvidenceLabel({ ...unresolved, payload: { landiqBooking: marker, landiqStaffRejection: null } })).toMatch(/Malformed rejection evidence.*blocked/);
    expect(courierEvidenceLabel({ ...unresolved, payload: { landiqBooking: { version: 3, state: "BOOKED" } } })).toMatch(/Legacy or malformed/);
  });
});
