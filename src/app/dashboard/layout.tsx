import type { ReactNode } from "react";
import { requirePageAccess } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageAccess(PERMISSIONS.DASHBOARD_VIEW);
  return <DashboardShell user={{ name: user.name, email: user.email, roles: user.roles }}>{children}</DashboardShell>;
}
