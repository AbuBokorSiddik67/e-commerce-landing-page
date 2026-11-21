// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnOperationKey } from "@/components/dashboard/ReturnOperationKey";

const first = "40000000-0000-4000-8000-000000000001";
const second = "40000000-0000-4000-8000-000000000002";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function value(container: HTMLElement) { return container.querySelector<HTMLInputElement>('input[name="idempotencyKey"]')?.value; }

describe("return receipt operation key", () => {
  it("survives remounts and changes only after the operator confirms another receipt", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const view = render(<ReturnOperationKey returnRequestId="return" orderItemId="item" />);
    expect(value(view.container)).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Start another receipt" }));
    expect(value(view.container)).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Start another receipt" }));
    expect(value(view.container)).toBe(second);
    view.unmount();
    expect(value(render(<ReturnOperationKey returnRequestId="return" orderItemId="item" />).container)).toBe(second);
  });

  it("leaves the server-required key blank when session storage fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
    const view = render(<ReturnOperationKey returnRequestId="return" orderItemId="item" />);
    expect(value(view.container)).toBe("");
    expect(screen.getByText(/Session storage is unavailable/)).toBeInTheDocument();
  });
});
