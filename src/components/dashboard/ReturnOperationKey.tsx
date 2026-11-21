"use client";

import { useEffect, useState } from "react";

/** Keep a receipt key across refreshes and lost responses in this tab. */
export function ReturnOperationKey({ returnRequestId, orderItemId }: { returnRequestId: string; orderItemId: string }) {
  const [key, setKey] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const storageKey = `landiq:return-receipt:${returnRequestId}:${orderItemId}`;

  useEffect(() => {
    try {
      let value = sessionStorage.getItem(storageKey);
      if (!value) {
        value = crypto.randomUUID();
        sessionStorage.setItem(storageKey, value);
      }
      setKey(value);
    } catch { setUnavailable(true); }
  }, [storageKey]);

  function newReceipt() {
    if (!window.confirm("Start a new receipt only after checking the previous result. Continue?")) return;
    try {
      const value = crypto.randomUUID();
      sessionStorage.setItem(storageKey, value);
      setKey(value);
    } catch { setUnavailable(true); setKey(""); }
  }

  return <>
    <input type="hidden" name="idempotencyKey" value={key} />
    {unavailable ? <p className="text-xs text-red-700">Session storage is unavailable; the server will reject this receipt.</p>
      : <p className="text-xs text-ink-500">Retry in this tab with the same quantity. {key && <button type="button" className="underline" onClick={newReceipt}>Start another receipt</button>}</p>}
  </>;
}
