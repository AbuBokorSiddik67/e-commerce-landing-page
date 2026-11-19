// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, Badge, EmptyState } from "@/components/ui";

describe("shared UI components", () => {
  it("renders server-provided error and success messages accessibly", () => {
    const { rerender } = render(<Alert error="Invalid coupon" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid coupon");
    rerender(<Alert success="Order placed" />);
    expect(screen.getByRole("status")).toHaveTextContent("Order placed");
  });

  it("renders badges and empty states with useful copy", () => {
    render(<><Badge tone="success">Published</Badge><EmptyState title="No orders yet" description="Share your page to get started." /></>);
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("Share your page to get started.")).toBeInTheDocument();
  });
});
