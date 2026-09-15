import { describe, expect, it } from "vitest";
import { findTrail, type HubLinks } from "../src/api/trail.ts";

/** Hubs from [slug, links] pairs. A hub's title is its slug in upper case. */
function hubs(...entries: Array<[string, string[]]>): Map<string, HubLinks> {
  return new Map(entries.map(([slug, links]) => [slug, { title: slug.toUpperCase(), links }]));
}

const crumb = (slug: string) => ({ slug, title: slug.toUpperCase() });

describe("findTrail", () => {
  it("returns every hub from the root down to the one that links the note", () => {
    const tree = hubs(["index", ["fields", "college"]], ["college", ["ge09"]], ["ge09", ["rizal-day"]], ["fields", ["org-chart"]]);
    expect(findTrail(tree, "rizal-day")).toEqual({ trail: [crumb("index"), crumb("college"), crumb("ge09")], inHub: true });
    expect(findTrail(tree, "ge09")).toEqual({ trail: [crumb("index"), crumb("college")], inHub: true });
    expect(findTrail(tree, "college")).toEqual({ trail: [crumb("index")], inHub: true });
  });

  it("prefers the shallower hub when two hubs at different depths list the note", () => {
    // The deeper hub is linked first, so a depth-first search would pick it.
    const tree = hubs(["index", ["college", "fields"]], ["college", ["ge09"]], ["ge09", ["shared"]], ["fields", ["shared"]]);
    expect(findTrail(tree, "shared")).toEqual({ trail: [crumb("index"), crumb("fields")], inHub: true });
  });

  it("prefers the hub linked first when two hubs at the same depth list the note", () => {
    const tree = hubs(["index", ["fields", "college"]], ["college", ["shared"]], ["fields", ["shared"]]);
    expect(findTrail(tree, "shared")).toEqual({ trail: [crumb("index"), crumb("fields")], inHub: true });

    // Order of links inside a hub body decides, not the order of the map.
    const reordered = hubs(["college", ["shared"]], ["fields", ["shared"]], ["index", ["college", "fields"]]);
    expect(findTrail(reordered, "shared")).toEqual({ trail: [crumb("index"), crumb("college")], inHub: true });
  });

  it("stops on hubs that link each other", () => {
    const tree = hubs(["index", ["a"]], ["a", ["b", "index"]], ["b", ["a", "b"]]);
    expect(findTrail(tree, "orphan")).toEqual({ trail: [], inHub: false });
    expect(findTrail(hubs(["index", ["a"]], ["a", ["b"]], ["b", ["a", "note"]]), "note")).toEqual({
      trail: [crumb("index"), crumb("a"), crumb("b")],
      inHub: true,
    });
  });

  it("does not follow links from a non-hub note or to slugs that do not exist", () => {
    // `specs` is a plain note, so it is not in the hub map and its link to `transcript` is never followed.
    const tree = hubs(["index", ["specs", "missing", "college"]], ["college", []]);
    expect(findTrail(tree, "transcript")).toEqual({ trail: [], inHub: false });
    expect(findTrail(tree, "specs")).toEqual({ trail: [crumb("index")], inHub: true });
  });

  it("gives the root an empty trail inside the hub tree", () => {
    expect(findTrail(hubs(["index", ["college"]], ["college", ["index"]]), "index")).toEqual({ trail: [], inHub: true });
  });

  it("reports nothing in a hub when the root hub is missing", () => {
    const tree = hubs(["college", ["ge09"]], ["ge09", ["rizal-day"]]);
    expect(findTrail(tree, "rizal-day")).toEqual({ trail: [], inHub: false });
    expect(findTrail(tree, "index")).toEqual({ trail: [], inHub: false });
    expect(findTrail(new Map(), "anything")).toEqual({ trail: [], inHub: false });
  });
});
