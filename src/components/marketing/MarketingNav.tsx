"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/demo", label: "Demo" },
  { href: "/purchase", label: "Purchase" },
  { href: "/docs", label: "Docs" },
  { href: "/contact", label: "Contact" },
];

export function MarketingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/95 backdrop-blur">
      <div className="container-wide flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 font-display text-lg font-bold">L</span>
          <span className="text-lg font-semibold tracking-tight">LANDIQ</span>
        </Link>
        <nav className="hidden items-center gap-5 lg:flex" aria-label="Main navigation">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={cn("text-sm transition hover:text-brand-300", pathname === link.href ? "text-brand-300" : "text-ink-200")}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 sm:inline-block">Owner login</Link>
          <button className="text-white lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-white/10 bg-ink-950 px-5 py-4 lg:hidden" aria-label="Mobile navigation">
          {[...links, { href: "/login", label: "Owner login" }].map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="block py-2 text-sm text-ink-100">{link.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
