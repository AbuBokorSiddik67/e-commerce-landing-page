import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";

export const reviewSchema = z.object({
  productId: z.string().min(1),
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  email: z.string().email().optional().or(z.literal("")),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().min(10).max(3000),
});

export async function submitReview(raw: z.input<typeof reviewSchema>) {
  const input = reviewSchema.parse(raw);
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product || product.status !== "PUBLISHED") throw new NotFoundError("Product not found");
  const verifiedOrder = await prisma.order.findFirst({
    where: {
      productId: input.productId, status: "DELIVERED",
      customer: { phone: input.phone },
    },
    select: { id: true, customerId: true },
  });
  const duplicate = await prisma.productReview.findFirst({
    where: { productId: input.productId, customerName: input.customerName, body: input.body },
  });
  if (duplicate) throw new ConflictError("A similar review already exists");
  return prisma.productReview.create({
    data: {
      productId: input.productId, customerName: input.customerName,
      customerId: verifiedOrder?.customerId ?? null, orderId: verifiedOrder?.id ?? null,
      rating: input.rating, title: input.title ?? null, body: input.body,
      status: "PENDING", verifiedPurchase: Boolean(verifiedOrder),
    },
  });
}

export async function moderateReview(id: string, status: "APPROVED" | "REJECTED", actorId: string) {
  const review = await prisma.productReview.findUnique({ where: { id } });
  if (!review) throw new NotFoundError("Review not found");
  const updated = await prisma.productReview.update({ where: { id }, data: { status } });
  await audit({ actorId, action: "MODERATE_REVIEW", entity: "ProductReview", entityId: id, before: { status: review.status }, after: { status } });
  return updated;
}

export async function approvedReviews(productId: string) {
  return prisma.productReview.findMany({
    where: { productId, status: "APPROVED" },
    select: { id: true, customerName: true, rating: true, title: true, body: true, verifiedPurchase: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 20,
  });
}
