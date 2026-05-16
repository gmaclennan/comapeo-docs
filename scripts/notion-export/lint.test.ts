import { describe, expect, it } from "vitest";
import { formatReport, lintMarkdown } from "./lint.ts";

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
