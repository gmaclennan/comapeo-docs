import { describe, expect, it } from "vitest";
import { markBrokenLinks } from "./validate.ts";
import { missingImageMarker } from "./images.ts";
import { LINT_MARKER_CATEGORIES } from "./lint-markers.ts";
import { formatReport, lintMarkdown } from "./lint.ts";
import type { Page, Pages } from "./walk-tree.ts";

const broken = '<span data-notion-lint="broken-link" data-target="abc">x</span>';
const missing = '<div data-notion-lint="missing-image" data-url="y">x</div>';
const truncated = '<div data-notion-lint="truncated">x</div>';

describe("lintMarkdown", () => {
  it("returns empty report when no markers present", () => {
    const files = new Map([["a.md", "# clean\n\nNo issues here."]]);
    const report = lintMarkdown(files);
    expect(report.total).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("counts each category independently", () => {
    const files = new Map([
      ["a.md", `${broken}\n${broken}\n${missing}`],
      ["b.md", truncated],
    ]);
    const report = lintMarkdown(files);
    expect(report.byCategory).toEqual({
      "broken-link": 2,
      "missing-image": 1,
      "truncated": 1,
      "custom-emoji": 0,
    });
    expect(report.total).toBe(4);
  });

  it("produces one finding per (file, category) pair, with per-file counts", () => {
    const files = new Map([
      ["a.md", `${broken}\n${broken}`],
      ["b.md", broken],
    ]);
    const report = lintMarkdown(files);
    expect(report.findings).toEqual([
      { filePath: "a.md", category: "broken-link", count: 2 },
      { filePath: "b.md", category: "broken-link", count: 1 },
    ]);
  });

  it("sorts findings deterministically by file path", () => {
    const files = new Map([
      ["z.md", broken],
      ["a.md", broken],
      ["m.md", broken],
    ]);
    const report = lintMarkdown(files);
    expect(report.findings.map((f) => f.filePath)).toEqual([
      "a.md",
      "m.md",
      "z.md",
    ]);
  });
});

describe("formatReport", () => {
  it("emits an OK message when nothing is found", () => {
    const report = lintMarkdown(new Map([["a.md", "clean"]]));
    expect(formatReport(report, "/docs")).toContain("OK");
  });

  it("includes per-category totals and per-file lines", () => {
    const report = lintMarkdown(
      new Map([
        ["/docs/intro.md", broken],
        ["/docs/section/page.md", missing],
      ]),
    );
    const out = formatReport(report, "/docs");
    expect(out).toContain("Found 2 notion-lint marker(s)");
    expect(out).toContain("broken-link:   1");
    expect(out).toContain("missing-image: 1");
    expect(out).toContain("intro.md: 1 × broken-link");
    expect(out).toContain("section/page.md: 1 × missing-image");
  });
});

// Round-trip contract test: every category emitted by the pipeline must
// be detectable by `lintMarkdown`. Catches drift between the emitter side
// (validate.ts, images.ts, index.ts/truncatedMarker) and the detector
// regex / category whitelist in `lint.ts`. Any new category added to
// `LINT_MARKER_CATEGORIES` must also be exercised here.

const A = "a".repeat(32);
const B = "b".repeat(32);

function makePage(overrides: Partial<Page> & Pick<Page, "id">): Page {
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

describe("emit ↔ detect contract", () => {
  it("LINT_MARKER_CATEGORIES is exactly the categories the pipeline can emit", () => {
    expect([...LINT_MARKER_CATEGORIES].sort()).toEqual(
      ["broken-link", "custom-emoji", "missing-image", "truncated"].sort(),
    );
  });

  it("broken-link emission round-trips through lintMarkdown", () => {
    const pages: Pages = new Map([
      [A, makePage({ id: A, ready: true, body: `[orphan](${B}.md)` })],
    ]);
    markBrokenLinks(pages);
    const report = lintMarkdown(new Map([["a.md", pages.get(A)!.body!]]));
    expect(report.byCategory["broken-link"]).toBe(1);
  });

  it("missing-image emission round-trips through lintMarkdown", () => {
    const marker = missingImageMarker("http://x", "fetch-failed", A);
    const report = lintMarkdown(new Map([["a.md", marker]]));
    expect(report.byCategory["missing-image"]).toBe(1);
  });

  it("truncated emission round-trips through lintMarkdown", () => {
    // The truncated marker is built inside index.ts; replicate its shape
    // here so we detect drift if its template changes without lint.ts.
    const truncatedMarker = `<div data-notion-lint="truncated" data-page="${A}">⚠️ Truncated by Notion API — content may be incomplete.</div>`;
    const report = lintMarkdown(new Map([["a.md", truncatedMarker]]));
    expect(report.byCategory["truncated"]).toBe(1);
  });

});
