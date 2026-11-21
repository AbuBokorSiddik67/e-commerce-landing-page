"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readCart, saveCart, type CartItem } from "@/lib/cart";

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try { setItems(readCart(localStorage)); } catch { setError("Cart storage is unavailable in this browser."); }
    setReady(true);
  }, []);

  function remove(item: CartItem) {
    try {
      const next = readCart(localStorage).filter((candidate) => !(candidate.productId === item.productId && candidate.variantId === item.variantId));
      saveCart(localStorage, next); setItems(next); setError("");
    } catch { setError("Could not update the cart in this browser."); }
  }

  return <main className="container-wide max-w-3xl py-12">
    <nav className="mb-6 flex gap-5 text-sm"><Link href="/shop" className="font-semibold text-brand-700 underline">← Browse products</Link></nav>
    <h1 className="text-3xl font-semibold">Your cart</h1>
    <p className="mt-3 text-sm text-ink-600">Each product is checked out as a separate order. Prices and stock are confirmed at checkout.</p>
    {error && <p role="alert" className="alert-error mt-4">{error}</p>}
    {ready && !items.length && <p className="mt-6 text-ink-500">Your cart is empty.</p>}
    <div className="mt-6 space-y-3">{items.map((item) => <div key={`${item.productId}:${item.variantId}`} className="surface flex flex-wrap items-center justify-between gap-4 p-5">
      <div><h2 className="font-semibold">{item.productName}</h2><p className="mt-1 text-sm text-ink-500">{item.variantName} · Quantity {item.quantity}</p></div>
      <div className="flex items-center gap-4">
        <Link className="btn-primary" href={`/p/${encodeURIComponent(item.slug)}?cartVariant=${encodeURIComponent(item.variantId)}&cartQuantity=${item.quantity}#order`}>Checkout</Link>
        <button type="button" onClick={() => remove(item)} className="text-sm font-semibold text-ink-600 underline">Remove</button>
      </div>
    </div>)}</div>
  </main>;
}
