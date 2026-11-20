import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { moderateReviewAction } from "@/app/actions/catalog";
import { formatDate } from "@/lib/utils";

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePageAccess(PERMISSIONS.REVIEW_MODERATE);
  const params = await searchParams;
  const reviews = await prisma.productReview.findMany({ include: { product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Reviews" description="Publish only genuine reviews. Verified status requires a delivered order matching the phone number." />
      <Alert error={params.error} success={params.success} />
      <Card className="p-6">{reviews.length ? <div className="space-y-4">{reviews.map((review) => <div key={review.id} className="flex flex-col gap-3 border-b border-ink-100 pb-4 last:border-0 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold">{review.title || "Review"}</p><Badge tone={review.status === "APPROVED" ? "success" : review.status === "REJECTED" ? "danger" : "warning"}>{review.status}</Badge>{review.verifiedPurchase && <Badge tone="info">Verified purchase</Badge>}</div><p className="mt-1 text-xs text-ink-500">{review.product.name} · {review.customerName} · {"★".repeat(review.rating)} · {formatDate(review.createdAt)}</p><p className="mt-2 max-w-3xl text-sm text-ink-600">{review.body}</p></div><div className="flex gap-2"><form action={moderateReviewAction}><input type="hidden" name="id" value={review.id} /><input type="hidden" name="status" value="APPROVED" /><button className="btn-secondary px-3 py-1.5">Approve</button></form><form action={moderateReviewAction}><input type="hidden" name="id" value={review.id} /><input type="hidden" name="status" value="REJECTED" /><button className="btn-ghost px-3 py-1.5 text-red-600">Reject</button></form></div></div>)}</div> : <p className="text-sm text-ink-500">No reviews submitted yet.</p>}</Card>
    </>
  );
}
