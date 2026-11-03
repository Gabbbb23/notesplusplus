import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/utils";

describe("cn with the M3 scales", () => {
  it("keeps a type role beside a colour role", () => {
    expect(cn("text-on-surface-variant text-body-medium")).toBe("text-on-surface-variant text-body-medium");
    expect(cn("bg-primary text-on-primary text-label-large")).toBe("bg-primary text-on-primary text-label-large");
  });

  it("lets a later class of the same scale win", () => {
    expect(cn("text-body-medium", "text-title-large")).toBe("text-title-large");
    expect(cn("text-on-primary", "text-on-surface")).toBe("text-on-surface");
    expect(cn("rounded-full", "rounded-small")).toBe("rounded-small");
    expect(cn("shadow-level1", "shadow-level2")).toBe("shadow-level2");
    expect(cn("ease-standard", "ease-emphasized-decelerate")).toBe("ease-emphasized-decelerate");
  });
});
