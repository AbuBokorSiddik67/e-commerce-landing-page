// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import { CheckoutForm } from "@/components/public/CheckoutForm";
import { PaymentReturn } from "@/components/public/PaymentReturn";
import { addCartItem, readCart, removeOrderedCartItem } from "@/lib/cart";
import { paymentReturnStorageKey } from "@/lib/checkout-recovery";

const item = { productId: "p1", slug: "first-product", productName: "First product", variantId: "v1", variantName: "Default", quantity: 1 };
const props = { productId: "p1", productName: "First product", productSlug: "first-product", regularPrice: 100, salePrice: null,
  variants: [{ id: "v1", name: "Default", price: null, stock: 2, sku: null }],
  methods: [{ code: "cod", name: "Cash on delivery", isDefault: true, sandbox: false }] };

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); navigation.push.mockReset(); navigation.replace.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("cart and checkout recovery", () => {
  it("adds and merges a cart item without submitting customer details or exceeding visible stock", () => {
    render(<CheckoutForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(readCart(localStorage)).toEqual([{ ...item, quantity: 2 }]);
    expect(screen.getByRole("status")).toHaveTextContent(/exceed the available quantity/);
  });

  it("removes only the ordered variant and matching quantity", () => {
    addCartItem(localStorage, item);
    addCartItem(localStorage, { ...item, productId: "p2", slug: "second-product", variantId: "v2" });
    removeOrderedCartItem(localStorage, "p1", "v1", 2);
    expect(readCart(localStorage)).toHaveLength(2);
    removeOrderedCartItem(localStorage, "p1", "v1", 1);
    expect(readCart(localStorage)).toMatchObject([{ productId: "p2" }]);
  });

  it("does not silently substitute a different variant for a stale cart item", () => {
    render(<CheckoutForm {...props} initialVariantId="old-variant" />);
    expect(screen.getByText(/cart variant is no longer available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Place order/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Variant/), { target: { value: "v1" } });
    expect(screen.getByRole("button", { name: /Place order/ })).toBeEnabled();
  });

  it("refreshes the delivery estimate for the chosen option and quantity", async () => {
    const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      return { ok: true, json: async () => ({ label: body.deliveryOption, charge: body.subtotal }) };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<CheckoutForm {...props} />);
    fireEvent.change(screen.getByLabelText(/District/), { target: { value: "Rajshahi" } });
    await screen.findByText(/Estimated charge:.*inside_city/);
    fireEvent.change(screen.getByLabelText(/Delivery option/), { target: { value: "outside_city" } });
    await screen.findByText(/Estimated charge:.*outside_city/);
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "2" } });
    await waitFor(() => expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1].body))).toMatchObject({
      district: "Rajshahi", deliveryOption: "outside_city", subtotal: 200,
    }));
  });

  it("recovers only the token held in the returning browser tab", async () => {
    const token = "A".repeat(32);
    sessionStorage.setItem(paymentReturnStorageKey("ORD-1"), token);
    const view = render(<PaymentReturn orderNumber="ORD-WRONG" autoRedirect />);
    expect(navigation.replace).not.toHaveBeenCalled();
    view.rerender(<PaymentReturn orderNumber="ORD-1" autoRedirect />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(`/order-confirmed?order=ORD-1&token=${token}`));
  });
});
