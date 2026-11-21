import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentFind: vi.fn(), paymentFindMany: vi.fn(), paymentUpsert: vi.fn(), paymentUpdateMany: vi.fn(),
  courierFind: vi.fn(), courierFindMany: vi.fn(), courierUpsert: vi.fn(), courierUpdateMany: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  paymentMethodConfiguration: { findUnique: mocks.paymentFind, findMany: mocks.paymentFindMany, upsert: mocks.paymentUpsert, updateMany: mocks.paymentUpdateMany },
  courierProviderConfiguration: { findUnique: mocks.courierFind, findMany: mocks.courierFindMany, upsert: mocks.courierUpsert, updateMany: mocks.courierUpdateMany },
} }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getCheckoutPaymentMethods, getCourierCredentialFromSnapshot, getCourierConfigurations, getPaymentConfigurations,
  testCourierConnection, testPaymentConnection, updateCourierConfiguration, updatePaymentConfiguration } from "@/lib/settings";

const key = "fixture-only-stable-encryption-key-32bytes";
const row = (code: string, credentials: Record<string, string>) => ({ id: `${code}-fixture`, code, name: code,
  enabled: true, visible: true, sandbox: true, isDefault: false, status: "configured", lastError: "fixture-old-secret",
  credentials });
const open = (value: string) => decryptSecret(value.slice(4));

beforeEach(() => {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", key);
  vi.clearAllMocks();
  mocks.paymentUpsert.mockResolvedValue({ id: "payment-fixture" });
  mocks.courierUpsert.mockResolvedValue({ id: "courier-fixture" });
  mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("provider credential storage", () => {
  it("preserves unchanged ciphertext, encrypts legacy plaintext and new fields, and redacts both audit snapshots", async () => {
    const clientId = `enc:${encryptSecret("fixture-account")}`;
    const existing = row("pathao", { clientId, clientSecret: "fixture-old-secret", otherLegacyField: "fixture-legacy" });
    mocks.courierFind.mockResolvedValue(existing);
    await updateCourierConfiguration("pathao", { visible: false, credentials: { clientSecret: "fixture-new-secret" } }, "fixture-actor");
    const saved = mocks.courierUpsert.mock.calls[0][0].update.credentials;
    expect(saved.clientId).toBe(clientId); // stable courier claim MAC
    expect(saved.clientSecret).toMatch(/^enc:/);
    expect(open(saved.clientSecret)).toBe("fixture-new-secret");
    expect(open(saved.otherLegacyField)).toBe("fixture-legacy");
    expect(JSON.stringify(saved)).not.toMatch(/fixture-(?:old-secret|new-secret|legacy|account)/);
    const audit = mocks.audit.mock.calls[0][0];
    expect(audit.before.credentials).toBe("[redacted]");
    expect(audit.after.credentials).toBe("[redacted]");
    expect(JSON.stringify(audit)).not.toMatch(/fixture-(?:old-secret|new-secret|legacy|account)/);
  });

  it("does not write unmodified payment secrets as plaintext when only a switch changes", async () => {
    const stored = { storeId: `enc:${encryptSecret("fixture-store-id")}`, storePassword: `enc:${encryptSecret("fixture-store-password")}` };
    mocks.paymentFind.mockResolvedValue(row("sslcommerz", stored));
    await updatePaymentConfiguration("sslcommerz", { visible: false }, "fixture-actor");
    expect(mocks.paymentUpsert.mock.calls[0][0].update.credentials).toEqual(stored);
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain("fixture-store-password");
  });

  it("fails closed on an incorrect key without writing or using environment fallback", async () => {
    const stored = { clientId: `enc:${encryptSecret("fixture-account")}`, clientSecret: `enc:${encryptSecret("fixture-secret")}` };
    mocks.courierFind.mockResolvedValue(row("pathao", stored));
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "wrong-fixture-encryption-key-32bytes");
    vi.stubEnv("PATHAO_CLIENT_ID", "different-account");
    vi.stubEnv("PATHAO_CLIENT_SECRET", "different-secret");
    await expect(updateCourierConfiguration("pathao", { isDefault: true }, "fixture-actor")).rejects.toThrow(/cannot be decrypted/);
    await expect(getCourierCredentialFromSnapshot("pathao", stored)).rejects.toThrow(/cannot be decrypted/);
    expect(mocks.courierUpsert).not.toHaveBeenCalled();
    expect(mocks.courierUpdateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("keeps unrelated COD available and reports an unreadable provider without exposing historical errors", async () => {
    const stored = { storeId: `enc:${encryptSecret("fixture-store")}`, storePassword: `enc:${encryptSecret("fixture-secret")}` };
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "wrong-fixture-encryption-key-32bytes");
    vi.stubEnv("SSLCOMMERZ_STORE_ID", "other-account");
    vi.stubEnv("SSLCOMMERZ_STORE_PASSWORD", "other-secret");
    mocks.paymentFindMany.mockResolvedValue([row("cod", {}), row("sslcommerz", stored)]);
    mocks.courierFindMany.mockResolvedValue([row("pathao", { clientId: stored.storeId, clientSecret: stored.storePassword })]);
    expect((await getCheckoutPaymentMethods()).map((method) => method.code)).toEqual(["cod"]);
    const payments = await getPaymentConfigurations();
    const courier = await getCourierConfigurations();
    expect(payments.find((entry) => entry.code === "sslcommerz")).toMatchObject({ configured: false, status: "credential_error" });
    expect(courier.find((entry) => entry.code === "pathao")).toMatchObject({ configured: false, status: "credential_error" });
    expect(JSON.stringify([payments, courier])).not.toContain("fixture-old-secret");
  });
});

describe("safe connection checks", () => {
  it("does not treat a fake SSLCommerz validation ID as a successful connection", async () => {
    mocks.paymentFind.mockResolvedValue(row("sslcommerz", { storeId: "fixture-id", storePassword: "fixture-password" }));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await testPaymentConnection("sslcommerz");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/sandbox checkout/);
    expect(mocks.paymentUpsert.mock.calls[0][0].update.status).toBe("unverified");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not persist or return provider-echoed errors, including when no config row exists", async () => {
    mocks.paymentFind.mockResolvedValue(null);
    vi.stubEnv("BKASH_APP_KEY", "fixture-key"); vi.stubEnv("BKASH_APP_SECRET", "fixture-secret");
    vi.stubEnv("BKASH_USERNAME", "fixture-user"); vi.stubEnv("BKASH_PASSWORD", "fixture-password");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "fixture-secret fixture-password" }), { status: 401 })));
    const result = await testPaymentConnection("bkash");
    expect(result.ok).toBe(false);
    expect(JSON.stringify([result, mocks.paymentUpsert.mock.calls])).not.toMatch(/fixture-(?:secret|password)/);
    expect(mocks.paymentUpsert).toHaveBeenCalledOnce();

    mocks.courierFind.mockResolvedValue(row("steadfast", { apiKey: "fixture-key", apiSecret: "fixture-secret" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 401, message: "fixture-secret" }), { status: 200 })));
    const courier = await testCourierConnection("steadfast");
    expect(courier.ok).toBe(false);
    expect(JSON.stringify([courier, mocks.courierUpsert.mock.calls])).not.toContain("fixture-secret");
  });
});
