import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePageAccess(PERMISSIONS.AUDIT_VIEW);
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
    prisma.auditLog.count(),
  ]);
  return (
    <>
      <PageHeader title="Audit logs" description={`${total} recorded actions. Credentials and customer details are redacted from audit payloads.`} />
      <Card className="p-6"><div className="table-wrap"><table className="table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatDate(log.createdAt, { dateStyle: "short", timeStyle: "short" })}</td><td>{log.actor?.name ?? "System"}</td><td className="font-medium">{log.action}</td><td>{log.entity}{log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ""}</td><td className="text-xs text-ink-400">{log.ip ?? "—"}</td></tr>)}</tbody></table></div>{total > 50 && <div className="mt-4 flex gap-2">{page > 1 && <a href={`/dashboard/audit?page=${page - 1}`} className="btn-secondary">Previous</a>}{page * 50 < total && <a href={`/dashboard/audit?page=${page + 1}`} className="btn-secondary">Next</a>}</div>}</Card>
    </>
  );
}
