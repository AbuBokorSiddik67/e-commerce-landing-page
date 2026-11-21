/** The order number is only a lookup for a capability already held in this tab. */
export function paymentReturnStorageKey(orderNumber: string) {
  return `landiq:payment-return:${orderNumber}`;
}

export function isTrackingToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}
