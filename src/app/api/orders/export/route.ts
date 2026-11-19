import { getCurrentUser } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.roles, PERMISSIONS.ORDER_VIEW)) return new Response("Unauthorized", { status: 403 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const orders = await prisma.order.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}) } } : {}),
    },
    include: { customer: true, items: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const headers = ["Order", "Date", "Customer", "Phone", "Email", "Items", "Subtotal", "Delivery", "Discount", "Total", "Payment", "Payment status", "Status", "Financial", "Settlement", "District", "Address"];
  const lines = [headers.join(","), ...orders.map((o) => [
    o.orderNumber, o.createdAt.toISOString(), o.customer.name, o.customer.phone, o.customer.email ?? "",
    o.items.map((i) => `${i.name} x${i.quantity}`).join("; "), o.subtotal, o.deliveryCharge, o.discount, o.total,
    o.paymentMethod, o.paymentStatus, o.status, o.financialStatus, o.settlementStatus, o.district, o.address,
  ].map(csvCell).join(","))];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="landiq-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
