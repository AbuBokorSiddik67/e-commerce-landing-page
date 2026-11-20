"use client";

import { useEffect, useState } from "react";

/** Keep the operation key across refreshes and lost responses in this tab. */
export function RefundOperationKey({ orderId, mode }: { orderId: string; mode: "internal" | "provider" }) {
  const [key, setKey] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const storageKey = `landiq:refund:${mode}:${orderId}`;

  useEffect(() => {
    try {
      let value = sessionStorage.getItem(storageKey);
      if (!value) {
        value = crypto.randomUUID();
        sessionStorage.setItem(storageKey, value);
      }
      setKey(value);
    } catch {
      // An empty key is rejected by the server; do not silently lose retry safety.
      setUnavailable(true);
    }
  }, [storageKey]);

  function newOperation() {
    if (!window.confirm("Start a different refund only after checking that the previous request is resolved. Continue?")) return;
    try {
      const value = crypto.randomUUID();
      sessionStorage.setItem(storageKey, value);
      setKey(value);
    } catch { setUnavailable(true); setKey(""); }
  }

  return <>
    <input type="hidden" name="idempotencyKey" value={key} />
    {unavailable ? <p className="text-xs text-red-700">Session storage is unavailable; refund submission is disabled by the server.</p> :
      <p className="text-xs text-ink-500">Retry this operation in the same tab. Start another only after checking the prior result. {key && <button type="button" className="underline" onClick={newOperation}>Start a different refund</button>}</p>}
  </>;
}
