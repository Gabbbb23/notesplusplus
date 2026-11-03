import { useRef } from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NoteBody } from "../src/components/note-body";
import { NoteOutline } from "../src/components/note-outline";

function Example({ markdown }: { markdown: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <MemoryRouter>
      <div ref={bodyRef}><NoteBody markdown={markdown} mentions={[]} /></div>
      <NoteOutline bodyRef={bodyRef} markdown={markdown} />
    </MemoryRouter>
  );
}

describe("note outline", () => {
  it("links every rendered heading, including repeated names and formatted text", () => {
    render(<Example markdown={"## Neovim\n\n### **Everyday**\n\n## Neovim\n\n```md\n# Not a heading\n```"} />);
    const outline = screen.getByRole("navigation", { name: "On this page" });
    const links = within(outline).getAllByRole("link");
    expect(links.slice(0, 3).map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Neovim", "#note-heading-1"],
      ["Everyday", "#note-heading-2"],
      ["Neovim", "#note-heading-3"],
    ]);
    expect(screen.getAllByRole("heading", { name: "Neovim" }).map((heading) => heading.id)).toEqual([
      "note-heading-1", "note-heading-3",
    ]);
    expect(links).toHaveLength(6);
  });

  it("shows no outline for a note without headings", () => {
    render(<Example markdown="A short note with no sections." />);
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
  });
});
