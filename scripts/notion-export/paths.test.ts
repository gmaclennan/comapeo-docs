import { describe, expect, it } from "vitest";
import { computePagePaths } from "./paths.ts";
import type { Page, Pages } from "./walk-tree.ts";

const ROOT = "00000000000000000000000000000000";
const A = "11111111111111111111111111111111";
const B = "22222222222222222222222222222222";
const C = "33333333333333333333333333333333";
const D = "44444444444444444444444444444444";

function page(overrides: Partial<Page>): Page {
  return {
    id: ROOT,
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

describe("computePagePaths", () => {
  it("root page lives at the top of docs/", () => {
    const root = page({ id: ROOT, title: "Root" });
    const pages = makePages(root);
    computePagePaths(pages);
    expect(root.relPath).toBe(`${ROOT}.md`);
  });

  it("top-level leaf page (no children) lives alongside root", () => {
    const root = page({ id: ROOT, childIds: [A], title: "Root" });
    const leaf = page({
      id: A,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      title: "About",
    });
    const pages = makePages(root, leaf);
    computePagePaths(pages);
    expect(leaf.relPath).toBe(`${A}.md`);
  });

  it("section page (has children) lives in its own slugified directory", () => {
    const root = page({ id: ROOT, childIds: [A], title: "Root" });
    const section = page({
      id: A,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      childIds: [B],
      title: "Getting Started",
    });
    const child = page({
      id: B,
      parentId: A,
      ancestorIds: [ROOT, A],
      depth: 2,
      title: "Installing",
    });
    const pages = makePages(root, section, child);
    computePagePaths(pages);
    expect(section.relPath).toBe(`getting-started/${A}.md`);
    expect(child.relPath).toBe(`getting-started/${B}.md`);
  });

  it("nested section: grandchild lives two directories deep", () => {
    const root = page({ id: ROOT, childIds: [A] });
    const section = page({
      id: A,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      childIds: [B],
      title: "Getting Started",
    });
    const subSection = page({
      id: B,
      parentId: A,
      ancestorIds: [ROOT, A],
      depth: 2,
      childIds: [C],
      title: "Photos",
    });
    const grandchild = page({
      id: C,
      parentId: B,
      ancestorIds: [ROOT, A, B],
      depth: 3,
      title: "Edit photos",
    });
    const pages = makePages(root, section, subSection, grandchild);
    computePagePaths(pages);
    expect(subSection.relPath).toBe(`getting-started/photos/${B}.md`);
    expect(grandchild.relPath).toBe(`getting-started/photos/${C}.md`);
  });

  it("throws when two sibling sections would share the same directory slug", () => {
    const root = page({ id: ROOT, childIds: [A, B] });
    const a = page({
      id: A,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      childIds: [C],
      title: "Setup",
    });
    const b = page({
      id: B,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      childIds: [D],
      title: "Setup", // same slug as a
    });
    const aChild = page({ id: C, parentId: A, ancestorIds: [ROOT, A], depth: 2 });
    const bChild = page({ id: D, parentId: B, ancestorIds: [ROOT, B], depth: 2 });
    const pages = makePages(root, a, b, aChild, bChild);
    expect(() => computePagePaths(pages)).toThrow(/share directory 'setup'/);
  });

  it("does not collide on leaves with identical titles (pageId disambiguates)", () => {
    const root = page({ id: ROOT, childIds: [A, B] });
    const x = page({
      id: A,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      title: "Same title",
    });
    const y = page({
      id: B,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      title: "Same title",
    });
    const pages = makePages(root, x, y);
    expect(() => computePagePaths(pages)).not.toThrow();
    expect(x.relPath).toBe(`${A}.md`);
    expect(y.relPath).toBe(`${B}.md`);
  });

  it("uses 'untitled' as the dir slug for sections with empty titles", () => {
    const root = page({ id: ROOT, childIds: [A] });
    const section = page({
      id: A,
      parentId: ROOT,
      ancestorIds: [ROOT],
      depth: 1,
      childIds: [B],
      title: "",
    });
    const child = page({ id: B, parentId: A, ancestorIds: [ROOT, A], depth: 2 });
    const pages = makePages(root, section, child);
    computePagePaths(pages);
    expect(section.relPath).toBe(`untitled/${A}.md`);
    expect(child.relPath).toBe(`untitled/${B}.md`);
  });
});
