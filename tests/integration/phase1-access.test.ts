import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real session/role checks at direct Server Action, API and page
// entry points. All data and service calls are mocked; no database is contacted.
const state = vi.hoisted(() => ({
  token: "fixture-session" as string | null,
  role: "VIEWER",
  session: vi.fn(), transaction: vi.fn(),
  orderFindMany: vi.fn(), orderFindUnique: vi.fn(), variantFindMany: vi.fn(),
  notificationFindMany: vi.fn(), refundFindMany: vi.fn(), returnFindMany: vi.fn(),
  listOrders: vi.fn(), getOrder: vi.fn(), getCustomer: vi.fn(), lowStock: vi.fn(), metrics: vi.fn(),
  bookCourier: vi.fn(), manualCourier: vi.fn(), cancelOrder: vi.fn(), updateOrder: vi.fn(),
  syncTracking: vi.fn(), collectCod: vi.fn(), settleCod: vi.fn(), expire: vi.fn(),
  recordRefund: vi.fn(), providerRefund: vi.fn(), createReturn: vi.fn(), updateReturn: vi.fn(), setStock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`TEST_REDIRECT:${url}`); },
  notFound: () => { throw new Error("TEST_NOT_FOUND"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  session: { findUnique: state.session }, $transaction: state.transaction,
  order: { findMany: state.orderFindMany, findUnique: state.orderFindUnique },
  productVariant: { findMany: state.variantFindMany },
  stockMovement: { findMany: vi.fn() }, notification: { findMany: state.notificationFindMany },
  refund: { findMany: state.refundFindMany }, returnRequest: { findMany: state.returnFindMany },
} }));
vi.mock("@/services/orders", () => ({
  listOrders: state.listOrders, getOrderForAdmin: state.getOrder, STATUS_LABELS: {},
  bookCourierShipment: state.bookCourier, assignManualCourier: state.manualCourier,
  cancelOrder: state.cancelOrder, updateOrderStatus: state.updateOrder, syncCourierTracking: state.syncTracking,
  collectCod: state.collectCod, settleCod: state.settleCod, expireEligibleReservations: state.expire,
}));
vi.mock("@/services/returns", () => ({
  recordRefund: state.recordRefund, executeProviderRefund: state.providerRefund,
  createReturnRequest: state.createReturn, updateReturnStatus: state.updateReturn,
}));
vi.mock("@/services/inventory", () => ({ setStock: state.setStock, lowStockVariants: state.lowStock }));
vi.mock("@/services/customers", () => ({ getCustomer: state.getCustomer, listCustomers: vi.fn(), updateCustomer: vi.fn() }));
vi.mock("@/services/analytics", () => ({ getDashboardMetrics: state.metrics, resolveRange: vi.fn(() => ({})) }));

import { bookCourierAction, cancelOrderAction, collectCodAction, expireReservationsAction, manualCourierAction, orderStatusAction, settleCodAction, syncTrackingAction } from "@/app/actions/orders";
import { createReturnAction, providerRefundAction, recordRefundAction, returnStatusAction } from "@/app/actions/catalog";
import { saveProductAction, setStockAction } from "@/app/actions/products";
import { GET as exportOrders } from "@/app/api/orders/export/route";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";
import DashboardOverview from "@/app/dashboard/page";
import OrdersPage from "@/app/dashboard/orders/page";
import OrderDetail from "@/app/dashboard/orders/[id]/page";
import Invoice from "@/app/dashboard/orders/[id]/invoice/page";
import CustomerDetail from "@/app/dashboard/customers/[id]/page";
import InventoryPage from "@/app/dashboard/inventory/page";
import ReturnsPage from "@/app/dashboard/returns/page";

beforeEach(() => {
  vi.clearAllMocks();
  state.token = "fixture-session";
  state.role = "VIEWER";
  state.session.mockImplementation(async () => ({ id: "session-1", revokedAt: null,
    expiresAt: new Date("2100-01-01"), user: { id: "user-1", name: "Fixture", email: "fixture@example.invalid",
      isActive: true, roles: [{ role: { key: state.role } }] } }));
  state.lowStock.mockResolvedValue([]);
  state.orderFindMany.mockResolvedValue([]);
  state.notificationFindMany.mockResolvedValue([]);
});

function form() {
  const value = new FormData();
  value.set("id", "fixture-order"); value.set("orderId", "fixture-order");
  value.set("shipmentId", "fixture-shipment"); value.set("transactionId", "fixture-payment");
  value.set("variantId", "fixture-variant"); value.set("idempotencyKey", "40000000-0000-4000-8000-000000000001");
  value.set("amount", "100"); value.set("reason", "Fixture refund"); value.set("provider", "fixture");
  return value;
}

describe("Phase 1 direct access controls", () => {
  it("denies unauthenticated direct courier and refund actions before any service call", async () => {
    state.token = null;
    await expect(bookCourierAction(form())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(providerRefundAction(form())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.bookCourier).not.toHaveBeenCalled();
    expect(state.providerRefund).not.toHaveBeenCalled();
    expect(state.session).not.toHaveBeenCalled();
  });

  it("denies a read-only viewer every direct stock, courier, cancellation, return and refund action", async () => {
    const actions = [bookCourierAction, manualCourierAction, cancelOrderAction, orderStatusAction, syncTrackingAction,
      collectCodAction, settleCodAction, createReturnAction, returnStatusAction, recordRefundAction, providerRefundAction, setStockAction];
    for (const action of actions) await expect(action(form())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(expireReservationsAction()).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const call of [state.bookCourier, state.manualCourier, state.cancelOrder, state.updateOrder, state.syncTracking,
      state.collectCod, state.settleCod, state.createReturn, state.updateReturn, state.recordRefund, state.providerRefund, state.setStock, state.expire]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("denies an orderless role direct order, invoice, return and export reads before data access", async () => {
    state.role = "PRODUCT_MANAGER";
    const params = Promise.resolve({ id: "fixture-order" });
    await expect(OrdersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("TEST_REDIRECT:/dashboard?error=forbidden");
    await expect(OrderDetail({ params, searchParams: Promise.resolve({}) })).rejects.toThrow("TEST_REDIRECT:/dashboard?error=forbidden");
    await expect(Invoice({ params })).rejects.toThrow("TEST_REDIRECT:/dashboard?error=forbidden");
    await expect(ReturnsPage()).rejects.toThrow("TEST_REDIRECT:/dashboard?error=forbidden");
    expect((await exportOrders(new Request("https://fixture.invalid/api/orders/export"))).status).toBe(403);
    expect(state.listOrders).not.toHaveBeenCalled();
    expect(state.getOrder).not.toHaveBeenCalled();
    expect(state.orderFindUnique).not.toHaveBeenCalled();
    expect(state.orderFindMany).not.toHaveBeenCalled();
    expect(state.returnFindMany).not.toHaveBeenCalled();
    expect(state.refundFindMany).not.toHaveBeenCalled();
  });

  it("denies customer and inventory pages to roles lacking their module permissions", async () => {
    state.role = "PRODUCT_MANAGER";
    await expect(CustomerDetail({ params: Promise.resolve({ id: "customer" }), searchParams: Promise.resolve({}) }))
      .rejects.toThrow("TEST_REDIRECT:/dashboard?error=forbidden");
    expect(state.getCustomer).not.toHaveBeenCalled();
    state.role = "MARKETING_MANAGER";
    await expect(InventoryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("TEST_REDIRECT:/dashboard?error=forbidden");
    expect(state.variantFindMany).not.toHaveBeenCalled();
    expect(state.lowStock).not.toHaveBeenCalled();
  });

  it("does not fetch unauthorized overview orders, analytics or notifications", async () => {
    state.role = "PRODUCT_MANAGER";
    await DashboardOverview({ searchParams: Promise.resolve({}) });
    expect(state.lowStock).toHaveBeenCalledTimes(1);
    expect(state.orderFindMany).not.toHaveBeenCalled();
    expect(state.metrics).not.toHaveBeenCalled();
    expect(state.notificationFindMany).not.toHaveBeenCalled();
  });

  it("prevents a product writer without inventory.write from forging a stock change", async () => {
    // No built-in role currently has products.write without inventory.write.
    // Use a synthetic role to exercise this independent permission boundary.
    state.role = "FIXTURE_PRODUCT_WRITER";
    ROLE_PERMISSIONS.FIXTURE_PRODUCT_WRITER = [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.PRODUCT_WRITE];
    const input = new FormData();
    input.set("id", "product"); input.set("name", "Fixture product"); input.set("slug", "fixture-product");
    input.set("regularPrice", "500"); input.set("status", "DRAFT"); input.set("expectedStatus", "DRAFT");
    input.set("variants", JSON.stringify([{ id: "variant", name: "Default", stock: 8, expectedStock: 7,
      expectedMovementCount: 1, expectedUpdatedAt: "2025-01-01T00:00:00.000Z", expectedAttributes: [], attributes: [] }]));
    try {
      await expect(saveProductAction(input)).rejects.toThrow(
        `TEST_REDIRECT:/dashboard/products?error=${encodeURIComponent("You do not have permission to perform this action")}`,
      );
      expect(state.session).toHaveBeenCalledTimes(2); // Product-write check, then inventory-write check.
      expect(state.transaction).not.toHaveBeenCalled();
      expect(state.setStock).not.toHaveBeenCalled();
    } finally { delete ROLE_PERMISSIONS.FIXTURE_PRODUCT_WRITER; }
  });
});
