// @vitest-environment node
import { describe, expect, it } from "vitest";
import { HOME_CRUMB, noteCrumbs, TAG_PAGE_CRUMBS, TOP_LEVEL_CRUMBS } from "../src/lib/breadcrumb-items";
import type { NoteTrail } from "../src/lib/types";

const INDEX = { slug: "index", title: "Index" };
const COLLEGE = { slug: "college", title: "College" };
const GE09 = { slug: "ge09-life-and-works-of-rizal", title: "GE09 Life and Works of Rizal" };

const hashTag = (tag: string) => `#${tag}`;
const crumbs = (trail: NoteTrail | undefined, tags: string[] = ["college"]) => noteCrumbs(trail, tags, hashTag);

describe("noteCrumbs", () => {
  it("a nested note: Home, then each hub below index, never the note itself", () => {
    expect(crumbs({ trail: [INDEX, COLLEGE, GE09], inHub: true })).toEqual([
      { label: "Home", to: "/" },
      { label: "College", to: "/notes/college" },
      { label: "GE09 Life and Works of Rizal", to: "/notes/ge09-life-and-works-of-rizal" },
    ]);
  });

  it("a hub or note that index lists directly: Home", () => {
    expect(crumbs({ trail: [INDEX], inHub: true })).toEqual([{ label: "Home", to: "/" }]);
  });

  it("index itself: Home", () => {
    expect(crumbs({ trail: [], inHub: true }, [])).toEqual([{ label: "Home", to: "/" }]);
  });

  it("a note no hub reaches, with tags: Home › Tags › its first tag", () => {
    expect(crumbs({ trail: [], inHub: false }, ["hardware", "laptop"])).toEqual([
      { label: "Home", to: "/" },
      { label: "Tags", to: "/tags" },
      { label: "#hardware", to: "/tags/hardware" },
    ]);
  });

  it("a note no hub reaches, without tags: Home", () => {
    expect(crumbs({ trail: [], inHub: false }, [])).toEqual([{ label: "Home", to: "/" }]);
  });

  it("while the trail loads or after it failed: Home alone", () => {
    expect(crumbs(undefined, ["hardware"])).toEqual([{ label: "Home", to: "/" }]);
  });

  it("encodes slugs and tags in the routes", () => {
    const trail = { trail: [INDEX, { slug: "a b", title: "A b" }], inHub: true };
    expect(crumbs(trail).at(-1)).toEqual({ label: "A b", to: "/notes/a%20b" });
    expect(crumbs({ trail: [], inHub: false }, ["c#"]).at(-1)).toEqual({ label: "#c#", to: "/tags/c%23" });
  });
});

describe("page breadcrumbs", () => {
  it("top-level pages sit under Home, and the Tag page under Tags", () => {
    expect(TOP_LEVEL_CRUMBS).toEqual([HOME_CRUMB]);
    expect(TAG_PAGE_CRUMBS).toEqual([
      { label: "Home", to: "/" },
      { label: "Tags", to: "/tags" },
    ]);
  });
});
