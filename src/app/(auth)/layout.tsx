import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-10 sm:px-12 lg:px-20">
        <Link href="/" className="flex w-fit items-center gap-2 text-ink-900"><span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-700 font-display text-xl font-bold text-white">L</span><span className="text-lg font-semibold">LANDIQ</span></Link>
        <div className="my-auto w-full max-w-md py-10">{children}</div>
        <p className="text-xs text-ink-400">© {new Date().getFullYear()} LANDIQ. Self-hosted commercial software.</p>
      </div>
      <div className="hidden flex-col justify-between bg-ink-950 p-16 text-white lg:flex">
        <div className="max-w-md"><span className="section-label text-brand-300">Owner dashboard</span><h2 className="mt-4 font-display text-4xl leading-tight">Everything about your store, in one place.</h2><p className="mt-5 text-ink-300">Products, landing pages, orders, delivery, staff and measured analytics — without subscriptions or forced integrations.</p></div>
        <div className="space-y-3 text-sm text-ink-300">{["Independent single-business installation", "COD works with zero gateway credentials", "Server-side roles and private tracking links"].map((item) => <p key={item}>✓ {item}</p>)}</div>
      </div>
    </div>
  );
}
