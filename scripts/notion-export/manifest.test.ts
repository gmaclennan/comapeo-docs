import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.ts";
import type { Page, Pages } from "./walk-tree.ts";

const ROOT = "00000000000000000000000000000000";
const A = "11111111111111111111111111111111";
const B = "22222222222222222222222222222222";

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

describe("buildManifest", () => {
  it("identifies the single root from a tree", () => {
    const pages = makePages(
      page({ id: ROOT, title: "Root", childIds: [A] }),
      page({
        id: A,
        title: "Article",
        parentId: ROOT,
        ancestorIds: [ROOT],
        depth: 1,
      }),
    );
    const m = buildManifest(pages);
    expect(m.version).toBe(1);
    expect(m.rootId).toBe(ROOT);
    expect(m.pages[ROOT].isRoot).toBe(true);
    expect(m.pages[A].isRoot).toBe(false);
  });

  it("flags sections by child count", () => {
    const pages = makePages(
      page({ id: ROOT, childIds: [A], title: "Root" }),
      page({
        id: A,
        parentId: ROOT,
        ancestorIds: [ROOT],
        depth: 1,
        childIds: [B],
        title: "Section",
      }),
      page({
        id: B,
        parentId: A,
        ancestorIds: [ROOT, A],
        depth: 2,
        title: "Leaf",
      }),
    );
    const m = buildManifest(pages);
    expect(m.pages[ROOT].isSection).toBe(true);
    expect(m.pages[A].isSection).toBe(true);
    expect(m.pages[B].isSection).toBe(false);
  });

  it("orders pages alphabetically by id for stable diffs", () => {
    const pages = makePages(
      page({
        id: B,
        title: "Z",
        parentId: ROOT,
        ancestorIds: [ROOT],
        depth: 1,
      }),
      page({
        id: A,
        title: "Y",
        parentId: ROOT,
        ancestorIds: [ROOT],
        depth: 1,
      }),
      page({ id: ROOT, title: "Root", childIds: [A, B] }),
    );
    const m = buildManifest(pages);
    expect(Object.keys(m.pages)).toEqual([ROOT, A, B]);
  });

  it("throws when no root page is present", () => {
    const pages = makePages(
      page({ id: A, parentId: ROOT, ancestorIds: [ROOT], depth: 1 }),
    );
    expect(() => buildManifest(pages)).toThrow(/no root page/i);
  });

  it("throws when multiple roots are present", () => {
    const pages = makePages(
      page({ id: ROOT, title: "Root 1" }),
      page({ id: A, title: "Root 2" }),
    );
    expect(() => buildManifest(pages)).toThrow(/Multiple root pages/);
  });

  it("preserves title, parentId, ancestorIds on entries", () => {
    const pages = makePages(
      page({ id: ROOT, title: "Root", childIds: [A] }),
      page({
        id: A,
        parentId: ROOT,
        ancestorIds: [ROOT],
        depth: 1,
        title: "Hello",
      }),
    );
    const m = buildManifest(pages);
    expect(m.pages[A]).toEqual({
      title: "Hello",
      parentId: ROOT,
      ancestorIds: [ROOT],
      isSection: false,
      isRoot: false,
    });
  });
});
