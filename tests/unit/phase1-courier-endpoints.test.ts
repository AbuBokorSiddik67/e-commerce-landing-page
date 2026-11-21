import { afterEach, describe, expect, it, vi } from "vitest";
import { pathaoProvider } from "@/lib/couriers/pathao";
import { steadfastProvider } from "@/lib/couriers/steadfast";
import { redxProvider } from "@/lib/couriers/redx";

// Every fetch is stubbed. This checks endpoint snapshot propagation, not the
// actual API contract or production provider behavior.
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("courier tracking and cancellation endpoint snapshots", () => {
  it.each([
    ["pathao", pathaoProvider, "PATHAO_API_BASE"],
    ["steadfast", steadfastProvider, "STEADFAST_API_BASE"],
    ["redx", redxProvider, "REDX_API_BASE"],
  ] as const)("uses the captured %s endpoint for tracking", async (_name, provider, envName) => {
    vi.stubEnv(envName, "https://changed.fixture.invalid");
    const hosts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      process.env[envName] = "https://changed-again.fixture.invalid";
      if (url.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      if (url.endsWith("/auth/token")) return new Response(JSON.stringify({ token: "token" }), { status: 200 });
      return new Response(JSON.stringify({ data: { status: "BOOKED" }, tracking: { status: "BOOKED" }, parcel: { status: "BOOKED" } }), { status: 200 });
    }));
    await provider.getTracking("track", { clientId: "fixture", clientSecret: "fixture", apiKey: "fixture", apiSecret: "fixture" }, true, "https://snapshot.fixture.invalid");
    expect(hosts.length).toBeGreaterThan(0); expect(new Set(hosts)).toEqual(new Set(["snapshot.fixture.invalid"]));
  });

  it("uses the captured Pathao endpoint for the cancellation request", async () => {
    vi.stubEnv("PATHAO_API_BASE", "https://changed.fixture.invalid");
    const hosts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      process.env.PATHAO_API_BASE = "https://changed-again.fixture.invalid";
      return new Response(JSON.stringify(url.endsWith("/oauth/token") ? { access_token: "token" } : {}), { status: 200 });
    }));
    await pathaoProvider.cancelShipment!("reference", { clientId: "fixture", clientSecret: "fixture" }, true, "https://snapshot.fixture.invalid");
    expect(hosts).toEqual(["snapshot.fixture.invalid", "snapshot.fixture.invalid"]);
  });
});
