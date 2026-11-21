import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { lowStockVariants } from "@/services/inventory";
import { setStockAction } from "@/app/actions/products";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const viewer = await requirePageAccess(PERMISSIONS.INVENTORY_VIEW);
  const canAdjust = viewer.permissions.has(PERMISSIONS.INVENTORY_WRITE);
  const params = await searchParams;
  const [variants, lowStock, movements] = await Promise.all([
    prisma.productVariant.findMany({ include: { product: true, _count: { select: { movements: true } } }, orderBy: [{ stock: "asc" }, { name: "asc" }], take: 100 }),
    lowStockVariants(),
    prisma.stockMovement.findMany({ include: { product: true, variant: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <>
      <PageHeader title="Inventory" description="Concurrency-safe stock, movement history and low-stock alerts." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {lowStock.length > 0 && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>{lowStock.length}</strong> variant(s) at or below their low-stock threshold.</div>}
          <div className="table-wrap"><table className="table"><thead><tr><th>Product / variant</th><th>SKU</th><th>Sellable</th><th>Damaged</th><th>Alert at</th>{canAdjust && <th>Adjust sellable</th>}</tr></thead><tbody>
            {variants.map((variant) => <tr key={variant.id}><td><p className="font-medium">{variant.product.name}</p><p className="text-xs text-ink-400">{variant.name}</p></td><td className="text-ink-500">{variant.sku ?? "—"}</td><td><Badge tone={variant.stock <= variant.lowStockThreshold ? "warning" : "success"}>{variant.stock}</Badge></td><td><Badge tone={variant.damagedStock ? "warning" : "neutral"}>{variant.damagedStock}</Badge></td><td>{variant.lowStockThreshold}</td>{canAdjust && <td><form action={setStockAction} className="flex items-center gap-2"><input type="hidden" name="variantId" value={variant.id} /><input type="hidden" name="expectedStock" value={variant.stock} /><input type="hidden" name="expectedMovementCount" value={variant._count.movements} /><input className="input w-20" type="number" min={0} max={2147483647} step={1} name="stock" defaultValue={variant.stock} required /><input className="input w-28" name="reason" placeholder="Reason" /><button className="btn-secondary px-3 py-1.5">Set</button></form></td>}</tr>)}
          </tbody></table></div>
        </div>
        <Card className="h-fit p-6"><h2 className="font-semibold">Recent movements</h2><div className="mt-4 space-y-3">{movements.map((movement) => <div key={movement.id} className="border-b border-ink-100 pb-3 last:border-0"><p className="text-sm font-medium">{movement.type} · {movement.bucket.toLowerCase()} <span className={movement.quantity > 0 ? "text-emerald-600" : "text-red-600"}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</span></p><p className="text-xs text-ink-500">{movement.product.name}{movement.variant ? ` · ${movement.variant.name}` : ""}</p><p className="text-xs text-ink-400">{movement.reason ?? "—"} · {formatDate(movement.createdAt)} · balance {movement.balanceAfter}</p></div>)}{!movements.length && <p className="text-sm text-ink-500">No movements recorded yet.</p>}</div></Card>
      </div>
    </>
  );
}
