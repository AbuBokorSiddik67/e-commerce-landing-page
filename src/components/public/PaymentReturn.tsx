"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isTrackingToken, paymentReturnStorageKey } from "@/lib/checkout-recovery";

/** Recover a previously received token in the same tab, never from the callback URL. */
export function PaymentReturn({ orderNumber, autoRedirect = false }: { orderNumber?: string; autoRedirect?: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (typeof orderNumber !== "string" || !orderNumber || orderNumber.length > 100) return;
    try {
      const saved = sessionStorage.getItem(paymentReturnStorageKey(orderNumber));
      if (!isTrackingToken(saved)) return;
      if (autoRedirect) {
        router.replace(`/order-confirmed?order=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(saved)}`);
      } else setToken(saved);
    } catch { /* A missing tab capability must not disclose order details. */ }
  }, [autoRedirect, orderNumber, router]);
  return token ? <Link href={`/track/${encodeURIComponent(token)}`} className="mt-6 inline-block text-sm font-semibold text-brand-700 underline">Check your order</Link> : null;
}
