import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Snippet } from "../src/components/snippet";

describe("<Snippet>", () => {
  it("renders hits as <mark> and escapes markup in the text", () => {
    const { container } = render(<Snippet snippet={`before <script>alert(1)</script> «hit» after`} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.querySelector("mark")?.textContent).toBe("hit");
    expect(container.innerHTML).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(container.innerHTML).not.toContain("«");
  });
});
