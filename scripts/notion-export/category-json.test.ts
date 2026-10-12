import { describe, expect, it } from "vitest";
import { buildCategoryJson } from "./category-json.ts";
import type { Page } from "./walk-tree.ts";

const ID = "00000000000000000000000000000000";

function section(overrides: Partial<Page> = {}): Page {
  return {
    id: ID,
    parentId: "ffffffffffffffffffffffffffffffff",
    ancestorIds: ["ffffffffffffffffffffffffffffffff"],
    childIds: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    depth: 1,
    position: 0,
    title: "Getting Started",
    icon: null,
    ready: false,
    markdown: "",
    truncated: false,
    unknownBlockIds: [],
    mentionIds: [],
    relPath: `getting-started/${ID}.md`,
    ...overrides,
  };
}

describe("buildCategoryJson", () => {
  it("links to the section doc when the section page is ready", () => {
    const sec = section({ ready: true });
    expect(buildCategoryJson(sec)).toEqual({
      label: "Getting Started",
      position: 0,
      link: { type: "doc", id: `getting-started/${ID}` },
    });
  });

  it("falls back to generated-index when the section page is draft", () => {
    const sec = section({ ready: false });
    expect(buildCategoryJson(sec)).toEqual({
      label: "Getting Started",
      position: 0,
      link: { type: "generated-index" },
    });
  });

  it("falls back to generated-index when relPath is missing", () => {
    const sec = section({ ready: true, relPath: undefined });
    expect(buildCategoryJson(sec).link).toEqual({ type: "generated-index" });
  });

  it("uses '(untitled)' label when the section has no title", () => {
    const sec = section({ title: "", ready: true });
    expect(buildCategoryJson(sec).label).toBe("(untitled)");
  });

  it("propagates position from the section page", () => {
    const sec = section({ ready: true, position: 3 });
    expect(buildCategoryJson(sec).position).toBe(3);
  });

  it("strips the .md extension when deriving doc id", () => {
    const sec = section({
      ready: true,
      relPath: `nested/deep/${ID}.md`,
    });
    expect(buildCategoryJson(sec).link).toEqual({
      type: "doc",
      id: `nested/deep/${ID}`,
    });
  });
});
