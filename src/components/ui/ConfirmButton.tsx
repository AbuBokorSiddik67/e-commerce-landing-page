"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ConfirmButton({ message, className, children, type = "submit" }: {
  message: string; className?: string; children: ReactNode; type?: "submit" | "button";
}) {
  return <button type={type} className={className} onClick={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>{children}</button>;
}
