// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import { CheckoutForm } from "@/components/public/CheckoutForm";

const first = "40000000-0000-4000-8000-000000000001";
const second = "40000000-0000-4000-8000-000000000002";
const props = { productId: "product", productName: "Fixture item", regularPrice: 100, salePrice: null,
  variants: [{ id: "variant", name: "Default", price: null, stock: 5, sku: null }],
  methods: [{ code: "cod", name: "Cash on delivery", isDefault: true, sandbox: false }] };

function fill() {
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Fixture Buyer" } });
  fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: "01700000000" } });
  fireEvent.change(screen.getByLabelText(/Full delivery address/), { target: { value: "123 Fixture Street" } });
  fireEvent.change(screen.getByLabelText(/District/), { target: { value: "Rajshahi" } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "2" } });
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); navigation.push.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("checkout request operation", () => {
  it("retains the same key after a lost response and reload, including for a sold-out multi-unit order", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(first);
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/delivery-quote") return { ok: false };
      if (url === "/api/events") return { ok: true };
      requests.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
      if (requests.length === 1) throw new Error("Connection lost");
      return { ok: true, json: async () => ({ orderNumber: "ORD-1", trackingToken: "token" }) };
    });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<CheckoutForm {...props} />);
    fill(); fireEvent.submit(view.container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(requests[0]).toMatchObject({ idempotencyKey: first, quantity: 2 });
    view.unmount();
    const soldOut = { ...props, variants: [{ ...props.variants[0], stock: 0 }] };
    const again = render(<CheckoutForm {...soldOut} />);
    expect(screen.getByText(/retry in this tab/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity/)).not.toHaveAttribute("readonly");
    fill();
    expect(screen.getByRole("button", { name: /Place order/ })).toBeEnabled();
    fireEvent.submit(again.container.querySelector("form")!);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/order-confirmed?order=ORD-1&token=token"));
    expect(requests[1]).toMatchObject({ idempotencyKey: first, quantity: 2 });
  });

  it("requires confirmation before creating a new purchase key", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(first).mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/delivery-quote" ? { ok: false } : Promise.reject(new Error("lost"))));
    const view = render(<CheckoutForm {...props} />); fill(); fireEvent.submit(view.container.querySelector("form")!);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Start a different order" }));
    expect(JSON.parse(sessionStorage.getItem("landiq:checkout:product")!).key).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Start a different order" }));
    expect(JSON.parse(sessionStorage.getItem("landiq:checkout:product")!).key).toBe(second);
    expect(screen.queryByText(/retry in this tab/)).not.toBeInTheDocument();
  });

  it("does not submit without persistent tab storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
    vi.stubGlobal("fetch", vi.fn());
    render(<CheckoutForm {...props} />);
    expect(screen.getByText(/Session storage is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Place order/ })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
