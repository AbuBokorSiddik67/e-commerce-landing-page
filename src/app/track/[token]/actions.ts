"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { finish, str } from "@/app/actions/helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { cancelCustomerOrder } from "@/services/orders";

/** Cancellation is authorized by the private tracking capability, not an order ID. */
export async function cancelCustomerOrderAction(formData: FormData) {
  const token = str(formData, "token");
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) redirect("/track/invalid");
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await finish(`/track/${encodeURIComponent(token)}`, async () => {
    checkRateLimit(`customer-cancellation:${ip}`, 10, 60 * 60 * 1000);
    return cancelCustomerOrder(token);
  }, "Your cancellation request was processed.");
}
