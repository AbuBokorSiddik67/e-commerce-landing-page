import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: false, report: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: async (permission: string) => {
  if (!state.allowed) throw new Error(`DENIED:${permission}`);
  return { id: "staff-1" };
} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`TEST_REDIRECT:${url}`); } }));
vi.mock("@/services/orders", () => ({}));
vi.mock("@/services/own-delivery", () => ({}));
vi.mock("@/services/courier-operations", () => ({ recordCourierRejectionEvidence: state.report }));
import { recordCourierRejectionAction } from "@/app/actions/orders";

function input() {
  const data = new FormData();
  data.set("id", "order"); data.set("shipmentId", "shipment"); data.set("merchantReference", "ORD-1");
  data.set("environment", "sandbox"); data.set("evidence", "Original account provider case number 12345");
  data.set("confirmOriginalAccount", "on"); data.set("confirmDefinitiveRejection", "on");
  return data;
}

beforeEach(() => { state.allowed = false; state.report.mockReset(); });
describe("courier rejection evidence action", () => {
  it("requires orders.write", async () => {
    await expect(recordCourierRejectionAction(input())).rejects.toThrow("DENIED:orders.write");
    expect(state.report).not.toHaveBeenCalled();
  });
  it("requires both original-account and request-specific rejection confirmations", async () => {
    state.allowed = true;
    for (const field of ["confirmOriginalAccount", "confirmDefinitiveRejection"]) {
      const form = input(); form.delete(field);
      await expect(recordCourierRejectionAction(form)).rejects.toThrow(/TEST_REDIRECT:.*error=/);
    }
    expect(state.report).not.toHaveBeenCalled();
    await expect(recordCourierRejectionAction(input())).rejects.toThrow(/TEST_REDIRECT:.*success=/);
    expect(state.report).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: "shipment", sandbox: true,
      merchantReference: "ORD-1", confirmOriginalAccount: true, confirmDefinitiveRejection: true }), "staff-1");
  });
});
