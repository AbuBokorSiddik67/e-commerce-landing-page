"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/utils";

type Variant = { id: string; name: string; price: number | null; stock: number; sku: string | null };
type Method = { code: string; name: string; isDefault: boolean; sandbox: boolean };
type CheckoutOperation = { key: string; submitted: boolean; storageKey: string };
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CheckoutForm({
  productId, productName, regularPrice, salePrice, variants, methods,
}: {
  productId: string; productName: string; regularPrice: number; salePrice: number | null;
  variants: Variant[]; methods: Method[];
}) {
  const router = useRouter();
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState(methods.find((m) => m.isDefault)?.code ?? methods[0]?.code ?? "cod");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [quote, setQuote] = useState<{ label: string; charge: number } | null>(null);
  const [district, setDistrict] = useState("");
  const [operation, setOperation] = useState<CheckoutOperation | null>(null);
  const [operationUnavailable, setOperationUnavailable] = useState(false);
  const storageKey = `landiq:checkout:${productId}`;

  // Keep only the random operation key and submission flag, not the customer's
  // address or payment details, across reloads in this tab.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      const saved: unknown = stored ? JSON.parse(stored) : { key: crypto.randomUUID(), submitted: false };
      if (!saved || typeof saved !== "object" || !("key" in saved) || !("submitted" in saved)
        || typeof saved.key !== "string" || !uuidV4.test(saved.key) || typeof saved.submitted !== "boolean") {
        throw new Error("Invalid checkout key");
      }
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
      setOperation({ key: saved.key, submitted: saved.submitted, storageKey });
      setOperationUnavailable(false);
    } catch { setOperation(null); setOperationUnavailable(true); }
  }, [storageKey]);

  function startNewOrder() {
    if (!window.confirm("Start a new order only after checking whether the previous order was received. Continue?")) return;
    try {
      const saved = { key: crypto.randomUUID(), submitted: false };
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
      setOperation({ ...saved, storageKey });
      setError(null); setOperationUnavailable(false);
    } catch { setOperation(null); setOperationUnavailable(true); }
  }

  const unit = variants.find((v) => v.id === variantId)?.price ?? salePrice ?? regularPrice;
  const maxStock = variants.find((v) => v.id === variantId)?.stock ?? 0;

  async function updateQuote(value: string) {
    setDistrict(value);
    if (value.trim().length < 2) { setQuote(null); return; }
    try {
      const response = await fetch("/api/delivery-quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district: value, deliveryOption: "inside_city", subtotal: unit * quantity }),
      });
      if (response.ok) setQuote(await response.json() as { label: string; charge: number });
    } catch { setQuote(null); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!operation || operation.storageKey !== storageKey) {
      setError("This browser cannot safely retain a checkout key. Please contact the store.");
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ key: operation.key, submitted: true }));
      setOperation({ ...operation, submitted: true });
    } catch {
      setOperationUnavailable(true);
      setError("This browser cannot safely retain a checkout key. Please contact the store.");
      return;
    }
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    let visitorId = "anonymous";
    try {
      visitorId = localStorage.getItem("landiq_visitor") ?? crypto.randomUUID();
      localStorage.setItem("landiq_visitor", visitorId);
    } catch { /* storage may be disabled; analytics stays pseudonymous */ }
    try {
      const response = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId, variantId, quantity,
          customer: {
            name: form.get("name"), phone: form.get("phone"), email: form.get("email"),
            address: form.get("address"), district: form.get("district"), area: form.get("area"),
          },
          deliveryOption: form.get("deliveryOption"), paymentMethod: method,
          couponCode: coupon || undefined, customerNote: form.get("customerNote"), visitorId, idempotencyKey: operation.key,
        }),
      });
      const data = await response.json() as { error?: string; checkoutUrl?: string; orderNumber?: string; trackingToken?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not place the order");
      await fetch("/api/events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "initiate_checkout", visitorId, productId }),
      }).catch(() => undefined);
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
      router.push(`/order-confirmed?order=${encodeURIComponent(data.orderNumber ?? "")}&token=${encodeURIComponent(data.trackingToken ?? "")}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place the order");
    } finally {
      setSubmitting(false);
    }
  }

  if (!methods.length) return <div className="alert-error">No payment methods are currently available. Please contact the store owner.</div>;

  return (
    <form onSubmit={submit} className="grid gap-5 rounded-3xl border border-ink-100 bg-white p-6 shadow-soft sm:p-8">
      {error && <div className="alert-error" role="alert">{error}</div>}
      <div className="flex items-baseline justify-between gap-4"><div><p className="text-xs uppercase tracking-wide text-ink-500">You are ordering</p><h3 className="mt-1 font-semibold">{productName}</h3></div><p className="text-xl font-semibold" style={{ color: "#206a53" }}>{formatMoney(unit)}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Full name *</span><input className="input" name="name" required minLength={2} /></label>
        <label className="block"><span className="label">Phone number *</span><input className="input" name="phone" required pattern="[0-9+\-\s()]{7,20}" /></label>
        <label className="block sm:col-span-2"><span className="label">Email (optional)</span><input className="input" type="email" name="email" /></label>
        <label className="block sm:col-span-2"><span className="label">Full delivery address *</span><textarea className="textarea" name="address" required minLength={5} /></label>
        <label className="block"><span className="label">District / City *</span><input className="input" name="district" required value={district} onChange={(e) => updateQuote(e.target.value)} /></label>
        <label className="block"><span className="label">Area (optional)</span><input className="input" name="area" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Variant *</span><select className="input" name="variant" value={variantId} onChange={(e) => { setVariantId(e.target.value); setQuantity(1); }}>{variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.stock === 0 ? " (out of stock)" : ` · ${v.stock} in stock`}</option>)}</select></label>
        <label className="block"><span className="label">Quantity *</span><input className="input" type="number" min={1} max={operation?.submitted ? 50 : Math.max(1, maxStock)} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} readOnly={maxStock <= 0 && !operation?.submitted} /></label>
      </div>
      <label className="block"><span className="label">Delivery option</span><select className="input" name="deliveryOption"><option value="inside_city">Inside city</option><option value="outside_city">Outside city</option></select>{quote && <span className="mt-1 block text-xs text-ink-500">Estimated charge: {formatMoney(quote.charge)} ({quote.label})</span>}</label>
      <div>
        <span className="label">Payment method *</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {methods.map((item) => <label key={item.code} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${method === item.code ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}><input type="radio" name="payment" value={item.code} checked={method === item.code} onChange={() => setMethod(item.code)} /><span className="font-medium">{item.name}</span>{item.sandbox && <span className="badge bg-amber-50 text-amber-700">Sandbox</span>}</label>)}
        </div>
      </div>
      <label className="block"><span className="label">Coupon code (optional)</span><input className="input uppercase" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="e.g. WELCOME10" /></label>
      <label className="block"><span className="label">Note (optional)</span><textarea className="textarea" name="customerNote" maxLength={1000} /></label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-5"><div><p className="text-xs text-ink-500">Subtotal</p><p className="text-lg font-semibold">{formatMoney(unit * quantity)}</p><p className="text-xs text-ink-400">Delivery charge calculated on the server before confirmation</p></div><button type="submit" disabled={submitting || operationUnavailable || !operation || operation.storageKey !== storageKey || (maxStock < 1 && !operation.submitted)} className="btn-primary px-6">{submitting ? <><Loader2 className="animate-spin" size={16} />Processing…</> : <>Place order <ChevronRight size={16} /></>}</button></div>
      {operationUnavailable ? <p className="text-xs text-red-700">Session storage is unavailable. Contact the store to place an order safely.</p>
        : operation?.submitted && <p className="text-xs text-ink-500">If the response was lost, retry in this tab with the same details, even if stock is now sold out. <button type="button" disabled={submitting} onClick={startNewOrder} className="underline">Start a different order</button></p>}
      <p className="text-xs text-ink-400">By placing an order you agree to the store&apos;s terms and privacy policy. Your details are used only to fulfil this order.</p>
    </form>
  );
}
