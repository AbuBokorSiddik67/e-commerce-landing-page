import { afterEach, describe, expect, it, vi } from "vitest";

const findConfiguration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { courierProviderConfiguration: { findUnique: findConfiguration } } }));

import { encryptSecret } from "@/lib/crypto";
import { getCourierCredentialFromSnapshot } from "@/lib/settings";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("courier credential snapshot", () => {
  it("decodes the supplied snapshot without rereading a newer database configuration", async () => {
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "fixture-encryption-key");
    const snapshot = { clientId: `enc:${encryptSecret("fixture-account-A")}`, clientSecret: `enc:${encryptSecret("fixture-secret-A")}` };
    findConfiguration.mockResolvedValue({ credentials: { clientId: "fixture-account-B", clientSecret: "fixture-secret-B" } });
    expect(await getCourierCredentialFromSnapshot("pathao", snapshot)).toEqual({ clientId: "fixture-account-A", clientSecret: "fixture-secret-A" });
    expect(findConfiguration).not.toHaveBeenCalled();
  });

  it("resolves empty credentials from the environment and rejects an unknown provider", async () => {
    vi.stubEnv("PATHAO_CLIENT_ID", "fixture-env-account");
    vi.stubEnv("PATHAO_CLIENT_SECRET", "fixture-env-secret");
    expect(await getCourierCredentialFromSnapshot("pathao", {})).toEqual({ clientId: "fixture-env-account", clientSecret: "fixture-env-secret" });
    await expect(getCourierCredentialFromSnapshot("unknown-fixture", {})).rejects.toThrow(/Unknown courier/);
    expect(findConfiguration).not.toHaveBeenCalled();
  });
});
