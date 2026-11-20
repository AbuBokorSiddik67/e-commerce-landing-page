// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefundOperationKey } from "@/components/dashboard/RefundOperationKey";

const first = "40000000-0000-4000-8000-000000000001";
const second = "40000000-0000-4000-8000-000000000002";
const third = "40000000-0000-4000-8000-000000000003";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function keyValue(container: HTMLElement) {
  const field = container.querySelector<HTMLInputElement>('input[name="idempotencyKey"]');
  if (!field) throw new Error("Refund key field missing");
  return field.value;
}

describe("refund operation key in same-tab session storage", () => {
  it("preserves a key across remounts but separates modes and orders", () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
    const view = render(<RefundOperationKey orderId="order-1" mode="provider" />);
    expect(keyValue(view.container)).toBe(first);
    view.unmount();
    const retry = render(<RefundOperationKey orderId="order-1" mode="provider" />);
    expect(keyValue(retry.container)).toBe(first);
    retry.unmount();
    const different = render(<RefundOperationKey orderId="order-1" mode="internal" />);
    expect(keyValue(different.container)).toBe(second);
    different.unmount();
    const otherOrder = render(<RefundOperationKey orderId="order-2" mode="provider" />);
    expect(keyValue(otherOrder.container)).toBe(third);
    expect(uuid).toHaveBeenCalledTimes(3);
  });

  it("changes the key only after the operator confirms a new operation", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(first).mockReturnValueOnce(second);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const view = render(<RefundOperationKey orderId="order-1" mode="provider" />);
    fireEvent.click(screen.getByRole("button", { name: "Start a different refund" }));
    expect(keyValue(view.container)).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Start a different refund" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(keyValue(view.container)).toBe(second);
    view.unmount();
    expect(keyValue(render(<RefundOperationKey orderId="order-1" mode="provider" />).container)).toBe(second);
  });

  it("leaves the key empty if storage cannot be accessed", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    const view = render(<RefundOperationKey orderId="order-1" mode="provider" />);
    expect(keyValue(view.container)).toBe("");
    expect(screen.getByText(/Session storage is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a different refund" })).not.toBeInTheDocument();
  });
});
