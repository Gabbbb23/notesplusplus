import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShowMore, ShowMoreLimit } from "../src/components/show-more";

describe("<ShowMore>", () => {
  it("is an outline button with the label and the progress text as its description", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ShowMore label="Show more notes" loading={false} progress="Showing 50 of 93" onClick={onClick} />,
    );
    const button = screen.getByRole("button", { name: "Show more notes" });
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveAccessibleDescription("Showing 50 of 93");
    expect(container.querySelector("[data-slot='show-more']")).toHaveTextContent("Show more notesShowing 50 of 93");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("stays in place, disabled and busy with a spinner, while loading", () => {
    const { rerender } = render(<ShowMore label="Show more results" loading={false} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Show more results" });
    expect(button.querySelector("svg.animate-spin")).toBeNull();

    rerender(<ShowMore label="Show more results" loading onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Show more results" })).toBe(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("has no description without progress text", () => {
    render(<ShowMore label="Show more results" loading={false} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Show more results" })).not.toHaveAttribute("aria-describedby");
  });

  it("ShowMoreLimit is a muted line in the button's spot", () => {
    render(<ShowMoreLimit>Showing the top 100. Refine the search to narrow it.</ShowMoreLimit>);
    const line = screen.getByText("Showing the top 100. Refine the search to narrow it.");
    expect(line).toHaveAttribute("data-slot", "show-more-limit");
    expect(line).toHaveClass("mt-4", "text-sm", "text-muted-foreground");
  });
});
