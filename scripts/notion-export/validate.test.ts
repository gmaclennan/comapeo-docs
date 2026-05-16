import { describe, expect, it } from "vitest";
import {
  applyBrokenLinkMarkers,
  validateCrossPageLinks,
} from "./validate.ts";
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

describe("applyBrokenLinkMarkers", () => {
  it("rewrites a broken link to a marker span with the target + reason", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `prefix [label](${C}.md) suffix`,
      }),
    );
    const broken = validateCrossPageLinks(pages);
    applyBrokenLinkMarkers(pages, broken);
    expect(pages.get(A)!.body).toBe(
      `prefix <span data-notion-lint="broken-link" data-target="${C}" data-reason="target-not-in-tree">⚠️ broken link</span> suffix`,
    );
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
    const broken = validateCrossPageLinks(pages);
    applyBrokenLinkMarkers(pages, broken);
    const out = pages.get(A)!.body!;
    expect(out).toContain(`[good](${B}.md)`);
    expect(out).toContain('data-notion-lint="broken-link"');
    expect(out).toContain(`data-target="${C}"`);
  });

  it("rewrites links to drafts with reason target-not-ready", () => {
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
    applyBrokenLinkMarkers(pages, broken);
    expect(pages.get(A)!.body).toContain('data-reason="target-not-ready"');
  });

  it("rewrites links with anchor fragments", () => {
    const pages = makePages(
      page({
        id: A,
        title: "Source",
        ready: true,
        body: `see [section](${C}.md#deep-anchor) below`,
      }),
    );
    const broken = validateCrossPageLinks(pages);
    applyBrokenLinkMarkers(pages, broken);
    expect(pages.get(A)!.body).not.toContain(`${C}.md`);
    expect(pages.get(A)!.body).toContain('data-notion-lint="broken-link"');
  });

  it("is a no-op when no links are broken", () => {
    const original = `[ok](${B}.md)`;
    const pages = makePages(
      page({ id: A, title: "Source", ready: true, body: original }),
      page({ id: B, title: "Target", ready: true }),
    );
    applyBrokenLinkMarkers(pages, validateCrossPageLinks(pages));
    expect(pages.get(A)!.body).toBe(original);
  });
});
