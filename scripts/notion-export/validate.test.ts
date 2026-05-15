import { describe, expect, it } from "vitest";
import { validateCrossPageLinks } from "./validate.ts";
import type { Page, Pages } from "./walk-tree.ts";

const A = "11111111111111111111111111111111";
const B = "22222222222222222222222222222222";
const C = "33333333333333333333333333333333";

function page(overrides: Partial<Page> & Pick<Page, "id">): Page {
  return {
    parentId: null,
    ancestorIds: [],
    childIds: [],
    depth: 0,
    position: 0,
    title: "",
    icon: null,
    ready: false,
    markdown: "",
    truncated: false,
    unknownBlockIds: [],
    mentionIds: [],
    ...overrides,
  };
}

function makePages(...entries: Page[]): Pages {
  return new Map(entries.map((p) => [p.id, p]));
}

describe("validateCrossPageLinks", () => {
  it("returns no errors when all links target ready pages in tree", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `Body\n[link](${B}.md)\n`,
      }),
      page({ id: B, title: "Target", ready: true }),
    );
    expect(validateCrossPageLinks(pages)).toEqual([]);
  });

  it("flags a link to a page that doesn't exist in the tree", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `[orphan](${C}.md)`,
      }),
    );
    const broken = validateCrossPageLinks(pages);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toEqual({
      sourcePageId: A,
      sourceTitle: "Source",
      targetPageId: C,
      reason: "target-not-in-tree",
    });
  });

  it("flags a link to a 🚧 page (in tree but not ready)", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `[draft](${B}.md)`,
      }),
      page({ id: B, title: "Draft", ready: false }),
    );
    const broken = validateCrossPageLinks(pages);
    expect(broken).toHaveLength(1);
    expect(broken[0].reason).toBe("target-not-ready");
  });

  it("ignores links inside 🚧 pages (those aren't built)", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Draft",
        ready: false,
        body: `[broken](${C}.md)`,
      }),
    );
    expect(validateCrossPageLinks(pages)).toEqual([]);
  });

  it("handles anchor fragments after the .md", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `[section](${B}.md#some-anchor)`,
      }),
      page({ id: B, title: "Target", ready: true }),
    );
    expect(validateCrossPageLinks(pages)).toEqual([]);
  });

  it("reports each broken link separately (multiple in one body)", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `[a](${B}.md) and [b](${C}.md)`,
      }),
    );
    const broken = validateCrossPageLinks(pages);
    expect(broken).toHaveLength(2);
  });
});
