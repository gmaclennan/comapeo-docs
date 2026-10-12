import { describe, expect, it, vi } from "vitest";
import { markBrokenLinks } from "./validate.ts";
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

describe("markBrokenLinks", () => {
  it("returns 0 when all links target ready pages in tree", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `Body\n[link](${B}.md)\n`,
      }),
      page({ id: B, title: "Target", ready: true }),
    );
    expect(markBrokenLinks(pages)).toBe(0);
    expect(pages.get(A)!.body).toBe(`Body\n[link](${B}.md)\n`);
  });

  it("rewrites a link to a page that doesn't exist in the tree", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `prefix [label](${C}.md) suffix`,
      }),
    );
    const count = markBrokenLinks(pages);
    expect(count).toBe(1);
    expect(pages.get(A)!.body).toBe(
      `prefix <span data-notion-lint="broken-link" data-page="${A}" data-target="${C}" data-reason="target-not-in-tree">⚠️ broken link</span> suffix`,
    );
  });

  it("rewrites a link to a 🚧 page with reason target-not-ready", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `[draft](${B}.md)`,
      }),
      page({ id: B, title: "Draft", ready: false }),
    );
    expect(markBrokenLinks(pages)).toBe(1);
    expect(pages.get(A)!.body).toContain('data-reason="target-not-ready"');
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
    expect(markBrokenLinks(pages)).toBe(0);
    expect(pages.get(A)!.body).toBe(`[broken](${C}.md)`);
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
    expect(markBrokenLinks(pages)).toBe(0);
    expect(pages.get(A)!.body).toContain(`${B}.md#some-anchor`);
  });

  it("rewrites links with anchor fragments when target is missing", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `see [section](${C}.md#deep-anchor) below`,
      }),
    );
    expect(markBrokenLinks(pages)).toBe(1);
    expect(pages.get(A)!.body).not.toContain(`${C}.md`);
    expect(pages.get(A)!.body).toContain('data-notion-lint="broken-link"');
  });

  it("counts each broken link separately (multiple in one body)", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `[a](${B}.md) and [b](${C}.md)`,
      }),
    );
    expect(markBrokenLinks(pages)).toBe(2);
  });

  it("preserves non-broken links in the same body", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `ok [good](${B}.md) bad [orphan](${C}.md)`,
      }),
      page({ id: B, title: "Target", ready: true }),
    );
    expect(markBrokenLinks(pages)).toBe(1);
    const out = pages.get(A)!.body!;
    expect(out).toContain(`[good](${B}.md)`);
    expect(out).toContain('data-notion-lint="broken-link"');
    expect(out).toContain(`data-target="${C}"`);
  });

  it("warns once per broken link", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pages = makePages(
        page({
          id: A,
          title: "Source",
          ready: true,
          body: `[a](${B}.md) and [b](${C}.md)`,
        }),
      );
      markBrokenLinks(pages);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
