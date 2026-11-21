"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BarChart3, Bell, Boxes, ClipboardList, CreditCard, FileText, Image, LayoutTemplate,
  LogOut, Menu, Package, RotateCcw, Settings, ShoppingCart, Store, Tag, Truck, Users, X, ShieldCheck, ScrollText,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

const nav = [
  { group: "Overview", items: [{ href: "/dashboard", label: "Overview", icon: BarChart3 }, { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 }] },
  { group: "Catalog", items: [
    { href: "/dashboard/products", label: "Products", icon: Package },
    { href: "/dashboard/categories", label: "Categories", icon: Boxes },
    { href: "/dashboard/pages", label: "Landing Pages", icon: FileText },
    { href: "/dashboard/templates", label: "Templates", icon: LayoutTemplate },
    { href: "/dashboard/inventory", label: "Inventory", icon: ClipboardList },
    { href: "/dashboard/media", label: "Media Library", icon: Image },
  ] },
  { group: "Sales", items: [
    { href: "/dashboard/orders", label: "Orders", icon: ShoppingCart },
    { href: "/dashboard/customers", label: "Customers", icon: Users },
    { href: "/dashboard/coupons", label: "Coupons", icon: Tag },
    { href: "/dashboard/reviews", label: "Reviews", icon: Store },
    { href: "/dashboard/returns", label: "Returns & Refunds", icon: RotateCcw },
  ] },
  { group: "Configuration", items: [
    { href: "/dashboard/payments", label: "Payment Settings", icon: CreditCard },
    { href: "/dashboard/couriers", label: "Courier & Shipping", icon: Truck },
    { href: "/dashboard/settings", label: "Business Settings", icon: Settings },
    { href: "/dashboard/integrations", label: "Marketing Integrations", icon: BarChart3 },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  ] },
  { group: "Administration", items: [
    { href: "/dashboard/staff", label: "Staff & Permissions", icon: ShieldCheck },
    { href: "/dashboard/audit", label: "Audit Logs", icon: ScrollText },
  ] },
];

export function DashboardShell({ children, user }: { children: ReactNode; user: { name: string; email: string; roles: string[] } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5"><Link href="/" className="flex items-center gap-2 text-white"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 font-display text-lg font-bold">L</span><span className="font-semibold">LANDIQ</span></Link><button className="text-ink-300 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Dashboard navigation">
        {nav.map((group) => <div key={group.group} className="mb-5">
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-500">{group.group}</p>
          {group.items.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition", pathname === item.href ? "bg-brand-700/30 font-semibold text-brand-200" : "text-ink-300 hover:bg-white/5 hover:text-white")}><item.icon size={17} />{item.label}</Link>)}
        </div>)}
      </nav>
      <div className="border-t border-white/10 p-4">
        <Link href="/change-password" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-white/5 hover:text-white"><ShieldCheck size={16} />Change password</Link>
        <form action={logoutAction}><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-white/5 hover:text-white"><LogOut size={16} />Sign out</button></form>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-ink-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 bg-ink-950 lg:block">{sidebar}</aside>
      {open && <><div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} /><aside className="fixed inset-y-0 left-0 z-50 w-64 bg-ink-950 lg:hidden">{sidebar}</aside></>}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ink-100 bg-white/90 px-5 backdrop-blur sm:px-8">
          <button className="text-ink-700 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
          <div className="hidden text-sm text-ink-500 lg:block">Single-business installation · <span className="font-semibold text-ink-700">Control center</span></div>
          <div className="ml-auto flex items-center gap-3 text-right"><div><p className="text-sm font-semibold text-ink-800">{user.name}</p><p className="text-xs text-ink-500">{user.roles[0] ?? "Staff"}</p></div><span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{user.name.slice(0, 1).toUpperCase()}</span></div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
