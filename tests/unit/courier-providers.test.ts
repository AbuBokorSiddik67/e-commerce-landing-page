import { afterEach, describe, expect, it, vi } from "vitest";
import { pathaoProvider } from "@/lib/couriers/pathao";
import { steadfastProvider } from "@/lib/couriers/steadfast";
import { redxProvider } from "@/lib/couriers/redx";

const shipment = {
  orderNumber: "fixture-order", customerName: "Fixture Buyer", phone: "01700000000",
  address: "Fixture Street", district: "Rajshahi", area: null, codAmount: 500,
  weightGrams: 500, items: "Fixture item",
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("courier provider account isolation", () => {
  it("uses a token obtained for each Pathao account and environment", async () => {
    // Synthetic responses; this does not verify the provider's actual API.
    vi.stubEnv("PATHAO_API_BASE", "");
    const bookings: Array<{ host: string; authorization: string | null }> = [];
    const authCalls: Array<{ host: string; client: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/oauth/token") {
        const body = JSON.parse(String(init?.body)) as { client_id: string };
        authCalls.push({ host: parsed.host, client: body.client_id });
        return new Response(JSON.stringify({ access_token: `token-${body.client_id}-${parsed.host}`, expires_in: 3600 }), { status: 200 });
      }
      if (parsed.pathname === "/api/v1/orders") {
        bookings.push({ host: parsed.host, authorization: new Headers(init?.headers).get("Authorization") });
        return new Response(JSON.stringify({ data: { consignment_id: `c-${bookings.length}` } }), { status: 200 });
      }
      throw new Error(`Unexpected synthetic request: ${url}`);
    }));
    await pathaoProvider.createShipment({ ...shipment, sandbox: true, credentials: { clientId: "account-A", clientSecret: "secret-A" } });
    await pathaoProvider.createShipment({ ...shipment, sandbox: true, credentials: { clientId: "account-B", clientSecret: "secret-B" } });
    await pathaoProvider.createShipment({ ...shipment, sandbox: false, credentials: { clientId: "account-B", clientSecret: "secret-B" } });
    expect(authCalls).toEqual([
      { host: "sandbox-api.pathao.com", client: "account-A" },
      { host: "sandbox-api.pathao.com", client: "account-B" },
      { host: "api.pathao.com", client: "account-B" },
    ]);
    expect(bookings).toEqual([
      { host: "sandbox-api.pathao.com", authorization: "Bearer token-account-A-sandbox-api.pathao.com" },
      { host: "sandbox-api.pathao.com", authorization: "Bearer token-account-B-sandbox-api.pathao.com" },
      { host: "api.pathao.com", authorization: "Bearer token-account-B-api.pathao.com" },
    ]);
  });

  it.each([
    ["pathao", pathaoProvider, "PATHAO_API_BASE", "sandbox-api.pathao.com"],
    ["steadfast", steadfastProvider, "STEADFAST_API_BASE", "sandbox-api.steadfast.com.bd"],
    ["redx", redxProvider, "REDX_API_BASE", "sandboxapi.redx.com.bd"],
  ] as const)("keeps the %s booking endpoint snapshot despite later environment changes", async (_name, provider, envName, defaultHost) => {
    for (const override of ["https://snapshot.fixture.invalid", null] as const) {
      vi.stubEnv(envName, "https://changed-before.fixture.invalid");
      const hosts: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        hosts.push(new URL(url).host);
        // Simulate a process-environment change while an adapter is running.
        process.env[envName] = "https://changed-during.fixture.invalid";
        if (url.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "fixture-token" }), { status: 200 });
        if (url.endsWith("/auth/token")) return new Response(JSON.stringify({ token: "fixture-token" }), { status: 200 });
        if (url.endsWith("/api/v1/orders")) return new Response(JSON.stringify({ data: { consignment_id: "pathao-c" } }), { status: 200 });
        if (url.endsWith("/orders/create")) return new Response(JSON.stringify({ consignment_id: "steadfast-c" }), { status: 200 });
        if (url.endsWith("/parcel")) return new Response(JSON.stringify({ parcel: { id: "redx-c" } }), { status: 200 });
        throw new Error(`Unexpected synthetic request: ${url}`);
      }));
      await provider.createShipment({ ...shipment, sandbox: true, apiBaseOverride: override,
        credentials: { clientId: "fixture", clientSecret: "fixture", apiKey: "fixture", apiSecret: "fixture" } });
      expect(hosts.length).toBeGreaterThan(0);
      expect(new Set(hosts)).toEqual(new Set([override ? "snapshot.fixture.invalid" : defaultHost]));
    }
  });
});
