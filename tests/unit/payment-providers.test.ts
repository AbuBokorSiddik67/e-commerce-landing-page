import { afterEach, describe, expect, it, vi } from "vitest";
import { sslcommerzProvider } from "@/lib/payments/sslcommerz";
import { bkashProvider } from "@/lib/payments/bkash";
import { nagadProvider } from "@/lib/payments/nagad";
import { getPaymentProvider } from "@/lib/payments/registry";

const baseInput = {
  orderId: "order-1", orderNumber: "LDQ-1", amount: 500, currency: "BDT", sandbox: true,
  customer: { name: "Buyer", phone: "01700000000", address: "Street", district: "Rajshahi" },
  urls: { success: "https://example.com/s", fail: "https://example.com/f", cancel: "https://example.com/c", ipn: "https://example.com/i" },
};

afterEach(() => vi.unstubAllGlobals());

describe("payment provider adapters", () => {
  it("requires credentials before making any network call", async () => {
    await expect(sslcommerzProvider.initialize({ ...baseInput, credentials: {} })).rejects.toThrow(/not configured/);
    await expect(bkashProvider.initialize({ ...baseInput, credentials: {} })).rejects.toThrow(/not configured/);
    await expect(nagadProvider.initialize({ ...baseInput, credentials: {} })).rejects.toThrow(/not configured/);
  });

  it("initializes SSLCommerz and never treats a non-VALID response as success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "VALID", gatewayPageURL: "https://sandbox.sslcommerz.com/pay", tran_id: "tran-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "VALID", tran_id: "tran-1", amount: "500" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sslcommerzProvider.initialize({ ...baseInput, credentials: { storeId: "id", storePassword: "secret" } });
    expect(result.checkoutUrl).toBe("https://sandbox.sslcommerz.com/pay");
    const verified = await sslcommerzProvider.verify({ val_id: "val-1", tran_id: "tran-1" }, { storeId: "id", storePassword: "secret" }, true);
    expect(verified.status).toBe("PAID");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "FAILED" }), { status: 200 })));
    const failed = await sslcommerzProvider.verify({ val_id: "bad" }, { storeId: "id", storePassword: "secret" }, true);
    expect(failed.status).toBe("FAILED");
  });

  it("verifies bKash only through the server-side query API", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: "token-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transactionStatus: "Completed", paymentID: "PID1", amount: "500", currency: "BDT" }), { status: 200 })));
    const result = await bkashProvider.verify({ paymentID: "PID1", trxID: "TRX1" }, {
      appKey: "k", appSecret: "s", username: "u", password: "p",
    }, true);
    expect(result.status).toBe("PAID");
    expect(result.reference).toBe("PID1");
  });

  it("does not reuse a bKash token after account password, username or environment changes", async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "fixture-token" }), { status: 200 }));
    // Each call must have a fresh Response body.
    mock.mockImplementation(async () => new Response(JSON.stringify({ id_token: "fixture-token" }), { status: 200 }));
    vi.stubGlobal("fetch", mock);
    const account = { appKey: "fixture-cache-key", appSecret: "fixture-cache-secret", username: "fixture-user-A", password: "fixture-password-A" };
    await bkashProvider.testConnection(account, true);
    await bkashProvider.testConnection(account, true);
    await bkashProvider.testConnection({ ...account, username: "fixture-user-B" }, true);
    await bkashProvider.testConnection({ ...account, password: "fixture-password-B" }, true);
    await bkashProvider.testConnection(account, false);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it("exposes a pluggable provider registry", () => {
    expect(getPaymentProvider("cod")).toBeNull();
    expect(getPaymentProvider("bkash")?.code).toBe("bkash");
  });
});
