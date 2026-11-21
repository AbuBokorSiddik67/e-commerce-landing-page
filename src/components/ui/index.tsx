import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Button({
  children, variant = "primary", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = { primary: "btn-primary", secondary: "btn-secondary", ghost: "btn-ghost", danger: "btn-danger" };
  return <button className={cn(styles[variant], className)} {...props}>{children}</button>;
}

export function LinkButton({ children, href, variant = "primary", className }: {
  children: ReactNode; href: string; variant?: "primary" | "secondary" | "ghost" | "danger"; className?: string;
}) {
  const styles = { primary: "btn-primary", secondary: "btn-secondary", ghost: "btn-ghost", danger: "btn-danger" };
  return <Link href={href} className={cn(styles[variant], className)}>{children}</Link>;
}

export function Card({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("surface", className)} {...rest}>{children}</div>;
}

export function Badge({ children, tone = "neutral", className }: {
  children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info"; className?: string;
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-600", success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700", danger: "bg-red-50 text-red-700", info: "bg-blue-50 text-blue-700",
  };
  return <span className={cn("badge", tones[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, required }: {
  label: string; name: string; hint?: string; children: ReactNode; required?: boolean;
}) {
  return (
    // The control is nested inside the label. Some callers intentionally omit
    // an id, so an htmlFor pointing at a missing id would break association.
    <label className="block">
      <span className="label">{label}{required && <span className="ml-0.5 text-red-500">*</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">✦</div>
      <h3 className="font-semibold text-ink-800">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) return <div className="alert-error mb-5" role="alert">{error}</div>;
  if (success) return <div className="alert-success mb-5" role="status">{success}</div>;
  return null;
}

export function Pagination({ page, pages, basePath }: { page: number; pages: number; basePath: string }) {
  if (pages <= 1) return null;
  const link = (p: number) => `${basePath}${basePath.includes("?") ? "&" : "?"}page=${p}`;
  return (
    <nav className="mt-5 flex items-center justify-between text-sm" aria-label="Pagination">
      <span className="text-ink-500">Page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={link(page - 1)} className="btn-secondary">Previous</Link>}
        {page < pages && <Link href={link(page + 1)} className="btn-secondary">Next</Link>}
      </div>
    </nav>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: string | number; hint?: string; icon?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-ink-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        </div>
        {icon && <div className="rounded-xl bg-brand-50 p-2 text-brand-700">{icon}</div>}
      </div>
    </Card>
  );
}

export function ToggleRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-ink-100 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold text-ink-800">{title}</p>{description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
