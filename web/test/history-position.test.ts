import { describe, expect, it } from "vitest";
import { createHistoryStack } from "../src/lib/history-position";

describe("the history stack behind Back and Forward", () => {
  it("has nowhere to go on the first entry of a fresh page", () => {
    const stack = createHistoryStack();
    expect(stack.visit("default", "POP")).toEqual({ canBack: false, canForward: false });
  });

  it("enables Back after a link, and Forward after going back", () => {
    const stack = createHistoryStack();
    stack.visit("a", "POP");
    expect(stack.visit("b", "PUSH")).toEqual({ canBack: true, canForward: false });
    expect(stack.visit("a", "POP")).toEqual({ canBack: false, canForward: true });
    expect(stack.visit("b", "POP")).toEqual({ canBack: true, canForward: false });
  });

  it("drops the forward entries when a link is followed from the middle", () => {
    const stack = createHistoryStack();
    stack.visit("a", "POP");
    stack.visit("b", "PUSH");
    stack.visit("c", "PUSH");
    stack.visit("b", "POP");
    expect(stack.visit("d", "PUSH")).toEqual({ canBack: true, canForward: false });
    expect(stack.visit("b", "POP")).toEqual({ canBack: true, canForward: true });
    expect(stack.visit("d", "POP")).toEqual({ canBack: true, canForward: false });
  });

  it("keeps the position when the entry is replaced, as the Tag page's filters do", () => {
    const stack = createHistoryStack();
    stack.visit("a", "POP");
    stack.visit("b", "PUSH");
    expect(stack.visit("b2", "REPLACE")).toEqual({ canBack: true, canForward: false });
    expect(stack.visit("a", "POP")).toEqual({ canBack: false, canForward: true });
    expect(stack.visit("b2", "POP")).toEqual({ canBack: true, canForward: false });
  });

  it("counts the browser's earlier entries for Back after a reload, but not unknown later ones", () => {
    const stack = createHistoryStack();
    expect(stack.visit("reloaded", "POP", { index: 3 })).toEqual({ canBack: true, canForward: false });
    expect(stack.visit("next", "PUSH")).toEqual({ canBack: true, canForward: false });
    expect(stack.visit("reloaded", "POP", { index: 3 })).toEqual({ canBack: true, canForward: true });
  });

  it("starts over at an entry it never saw, such as one from before the page loaded", () => {
    const stack = createHistoryStack();
    stack.visit("a", "POP");
    stack.visit("b", "PUSH");
    expect(stack.visit("older", "POP", { index: 0 })).toEqual({ canBack: false, canForward: false });
  });

  it("treats a jump to a heading, an entry the browser made with no index, as one pushed after the current", () => {
    const stack = createHistoryStack();
    stack.visit("a", "POP", { index: 0 });
    stack.visit("b", "PUSH", { index: 1 });
    expect(stack.visit("default#note-heading-3", "POP")).toEqual({ canBack: true, canForward: false });
    expect(stack.visit("b", "POP", { index: 1 })).toEqual({ canBack: true, canForward: true });
    expect(stack.visit("a", "POP", { index: 0 })).toEqual({ canBack: false, canForward: true });
  });
});
