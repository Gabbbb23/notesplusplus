import { useEffect, useState, type RefObject } from "react";
import { Ripple } from "@/components/ui/ripple";
import { cn } from "@/lib/utils";

interface Heading {
  id: string;
  label: string;
  level: number;
}

export function NoteOutline({ bodyRef, markdown }: { bodyRef: RefObject<HTMLDivElement | null>; markdown: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const elements = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6") ?? []);
    const next = elements.map((element, index) => {
      const id = `note-heading-${index + 1}`;
      element.id = id;
      element.classList.add("scroll-mt-20");
      return { id, label: element.textContent?.trim() || `Heading ${index + 1}`, level: Number(element.tagName[1]) };
    });
    setHeadings(next);
    const hash = window.location.hash.slice(1);
    if (next.some((heading) => heading.id === hash)) {
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [bodyRef, markdown]);

  if (headings.length === 0) return null;

  // Deeper headings step in 12px per level from the title's 16px inset.
  const links = headings.map(({ id, label, level }) => (
    <a
      key={id}
      href={`#${id}`}
      aria-current={active === id ? "location" : undefined}
      className={cn(
        "relative block rounded-medium py-1.5 pr-4 text-body-medium wrap-break-word",
        active === id ? "font-medium text-primary" : "text-on-surface-variant",
      )}
      style={{ paddingLeft: `${(level - 1) * 12 + 16}px` }}
      onClick={() => setActive(id)}
    >
      {label}
      <Ripple />
    </a>
  ));

  return (
    <nav aria-label="On this page" className="min-w-0">
      <div className="px-4 pb-2 text-title-small text-on-surface-variant">On this page</div>
      <div className="hidden max-h-[calc(100vh-8rem)] overflow-y-auto large:block">{links}</div>
      <details className="large:hidden">
        <summary className="relative cursor-pointer rounded-full px-4 py-2 text-label-large text-on-surface-variant">
          Headings
          <Ripple />
        </summary>
        <div className="max-h-60 overflow-y-auto">{links}</div>
      </details>
    </nav>
  );
}
