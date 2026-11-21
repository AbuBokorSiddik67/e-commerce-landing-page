import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS, ROLE_PERMISSIONS, ALL_PERMISSIONS } from "@/lib/permissions";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { createStaffAction, resetStaffPasswordAction, updateStaffRolesAction } from "@/app/actions/staff";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePageAccess(PERMISSIONS.STAFF_VIEW);
  const params = await searchParams;
  const [users, roles] = await Promise.all([
    prisma.user.findMany({ include: { roles: { include: { role: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.role.findMany({ orderBy: { key: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Staff & permissions" description="Seven default roles with server-side enforcement. Owner permissions cannot be edited." />
      <Alert error={params.error} success={params.success} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">{users.map((user) => <Card key={user.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{user.name}</p><p className="text-xs text-ink-500">{user.email} · last login {user.lastLoginAt ? formatDate(user.lastLoginAt) : "never"}</p></div><div className="flex gap-1">{user.roles.map((r) => <Badge key={r.roleId} tone={r.role.key === "OWNER" ? "success" : "info"}>{ROLE_LABELS[r.role.key] ?? r.role.key}</Badge>)}<Badge tone={user.isActive ? "success" : "danger"}>{user.isActive ? "Active" : "Disabled"}</Badge></div></div>
          {!user.roles.some((r) => r.role.key === "OWNER") && <form action={updateStaffRolesAction} className="mt-4 flex flex-wrap items-center gap-3"><input type="hidden" name="id" value={user.id} />{roles.filter((r) => r.key !== "OWNER").map((role) => <label key={role.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="roleIds" value={role.id} defaultChecked={user.roles.some((ur) => ur.roleId === role.id)} />{ROLE_LABELS[role.key] ?? role.name}</label>)}<label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="isActive" defaultChecked={user.isActive} />Enabled</label><button className="btn-secondary px-3 py-1.5">Save roles</button></form>}
          {!user.roles.some((r) => r.role.key === "OWNER") && <form action={resetStaffPasswordAction} className="mt-3 flex gap-2"><input type="hidden" name="id" value={user.id} /><input className="input" type="password" name="password" placeholder="New temporary password" minLength={10} required /><button className="btn-ghost text-xs">Reset and revoke sessions</button></form>}
        </Card>)}</div>
        <div className="space-y-6"><Card className="p-6"><h2 className="font-semibold">Add staff member</h2><form action={createStaffAction} className="mt-4 space-y-3"><label className="block"><span className="label">Name</span><input className="input" name="name" required /></label><label className="block"><span className="label">Email</span><input className="input" type="email" name="email" required /></label><label className="block"><span className="label">Initial password</span><input className="input" type="password" name="password" minLength={10} required /></label><fieldset><legend className="label">Roles</legend><div className="space-y-1">{roles.filter((r) => r.key !== "OWNER").map((role) => <label key={role.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roleIds" value={role.id} />{ROLE_LABELS[role.key] ?? role.name}</label>)}</div></fieldset><button className="btn-primary w-full">Create staff account</button></form></Card>
          <Card className="p-6"><h2 className="font-semibold">Role matrix</h2><div className="mt-4 space-y-3">{Object.entries(ROLE_PERMISSIONS).map(([key, perms]) => <div key={key}><p className="text-sm font-semibold">{ROLE_LABELS[key]}</p><p className="text-xs text-ink-500">{perms.length} of {ALL_PERMISSIONS.length} permissions · {perms.slice(0, 4).map((p) => p.replace(".", " ")).join(", ")}…</p></div>)}<p className="text-xs text-ink-400">Owner has all permissions by design and cannot be downgraded here.</p></div></Card>
        </div>
      </div>
    </>
  );
}
