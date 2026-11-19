import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";

export async function listCustomers(options: { search?: string; tag?: string; page?: number; perPage?: number } = {}) {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, options.perPage ?? 20);
  const where = {
    ...(options.search ? { OR: [
      { name: { contains: options.search, mode: "insensitive" as const } },
      { phone: { contains: options.search } },
      { email: { contains: options.search, mode: "insensitive" as const } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        orders: { select: { id: true, total: true, status: true, createdAt: true, paymentStatus: true } },
        addresses: true,
      },
      orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage,
    }),
    prisma.customer.count({ where }),
  ]);
  const items = rows.map((row) => ({
    ...row,
    orderCount: row.orders.length,
    totalSpending: row.orders
      .filter((order) => ["PAID", "COD_COLLECTED", "COD_SETTLED"].includes(order.paymentStatus))
      .reduce((sum, order) => sum + order.total, 0),
  })).filter((row) => !options.tag || ((row.tags as string[]) ?? []).includes(options.tag));
  return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
}

export async function getCustomer(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { addresses: true, orders: { orderBy: { createdAt: "desc" }, include: { items: true } } },
  });
  if (!customer) throw new NotFoundError("Customer not found");
  return customer;
}

export async function updateCustomer(id: string, data: { name?: string; email?: string | null; notes?: string | null; tags?: string[] }, actorId: string) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Customer not found");
  const updated = await prisma.customer.update({
    where: { id },
    data: { ...data, tags: (data.tags ?? existing.tags) as never },
  });
  await audit({ actorId, action: "UPDATE_CUSTOMER", entity: "Customer", entityId: id, before: { name: existing.name, notes: existing.notes }, after: { name: updated.name, notes: updated.notes } });
  return updated;
}

export async function duplicateCustomers() {
  const groups = await prisma.customer.groupBy({
    by: ["phone"], _count: { phone: true }, having: { phone: { _count: { gt: 1 } } },
  });
  return groups;
}
