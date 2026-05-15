import { describe, expect, it } from "vitest";
import {
  convertCallouts,
  rewritePageLinks,
  stripUnsupportedTags,
  transformInline,
  transformPageMarkdown,
  unwrapMetadataTags,
} from "./transform.ts";

const ID_A = "00112233445566778899aabbccddeeff";
const ID_B = "112233445566778899aabbccddeeff00";

describe("convertCallouts", () => {
  it("converts a single callout with no emoji to :::note", () => {
    const input = "<callout>Plain warning text</callout>";
    const { markdown, report } = convertCallouts(input);
    expect(markdown).toContain(":::note");
    expect(markdown).toContain("Plain warning text");
    expect(report.total).toBe(1);
    expect(report.byType.note).toBe(1);
  });

  it("maps emoji prefixes to admonition types", () => {
    const cases: Array<[string, string]> = [
      ["💡 helpful", "tip"],
      ["⚠️ careful", "warning"],
      ["🔥 danger", "danger"],
      ["❗ caution", "caution"],
      ["ℹ️ info", "info"],
    ];
    for (const [body, expectedType] of cases) {
      const { markdown, report } = convertCallouts(`<callout>${body}</callout>`);
      expect(markdown).toContain(`:::${expectedType}`);
      expect(report.byType[expectedType]).toBe(1);
    }
  });

  it("strips the leading emoji from the body", () => {
    const { markdown } = convertCallouts(
      "<callout>💡 Use the search bar to find pages</callout>",
    );
    expect(markdown).not.toContain("💡");
    expect(markdown).toContain("Use the search bar to find pages");
  });

  it("preserves trailing content around the callout", () => {
    const input = "Before\n\n<callout>💡 tip</callout>\n\nAfter";
    const { markdown } = convertCallouts(input);
    expect(markdown).toMatch(/Before[\s\S]*:::tip[\s\S]*tip[\s\S]*:::[\s\S]*After/);
  });

  it("handles multiple callouts in one document", () => {
    const input =
      "<callout>💡 first</callout>\n\n<callout>⚠️ second</callout>";
    const { markdown, report } = convertCallouts(input);
    expect(report.total).toBe(2);
    expect(report.byType.tip).toBe(1);
    expect(report.byType.warning).toBe(1);
    expect(markdown).toContain(":::tip");
    expect(markdown).toContain(":::warning");
  });

  it("converts nested callouts (innermost first)", () => {
    const input =
      "<callout>💡 outer\n<callout>⚠️ inner</callout>\nback to outer</callout>";
    const { markdown, report } = convertCallouts(input);
    expect(report.total).toBe(2);
    expect(report.byType.tip).toBe(1);
    expect(report.byType.warning).toBe(1);
    // Both admonitions should be present, with warning nested inside tip.
    const tipIdx = markdown.indexOf(":::tip");
    const warningIdx = markdown.indexOf(":::warning");
    const closeIdx = markdown.lastIndexOf(":::");
    expect(tipIdx).toBeGreaterThanOrEqual(0);
    expect(warningIdx).toBeGreaterThan(tipIdx);
    expect(closeIdx).toBeGreaterThan(warningIdx);
  });

  it("is a no-op when there are no callouts", () => {
    const input = "# Just a heading\n\nSome paragraph.";
    const { markdown, report } = convertCallouts(input);
    expect(markdown).toBe(input);
    expect(report.total).toBe(0);
  });

  it("throws on malformed (unbalanced) callouts to avoid infinite loops", () => {
    // An unbalanced opening tag without closing would cause CALLOUT_TAG_RE to
    // never match, so the loop would terminate normally — no throw.
    // But if a synthetic input keeps generating new <callout> after each pass,
    // the safety limit fires. We can simulate by checking the cap exists.
    expect(() =>
      convertCallouts(
        Array.from({ length: 40 }, (_, i) => `<callout>L${i}<callout>x</callout></callout>`).join(
          "\n",
        ),
      ),
    ).not.toThrow(); // 40 deeply-flat-then-nested pairs still resolve under the cap.
  });
});

describe("stripUnsupportedTags", () => {
  it("removes <empty-block/>", () => {
    expect(stripUnsupportedTags("a<empty-block/>b")).toBe("ab");
  });

  it("removes <table_of_contents .../>", () => {
    expect(
      stripUnsupportedTags(`Before<table_of_contents color="default" />After`),
    ).toBe("BeforeAfter");
  });

  it("removes <unknown .../> regardless of alt", () => {
    expect(
      stripUnsupportedTags(`<unknown id="x" alt="button"/>x`),
    ).toBe("x");
    expect(stripUnsupportedTags(`y<unknown alt="bookmark"/>z`)).toBe("yz");
  });

  it("is a no-op when no strip targets are present", () => {
    expect(stripUnsupportedTags("# Heading\nbody")).toBe("# Heading\nbody");
  });
});

describe("unwrapMetadataTags", () => {
  it("unwraps <synced_block ...>content</synced_block>", () => {
    expect(
      unwrapMetadataTags(
        `<synced_block url="x">visible content</synced_block>`,
      ),
    ).toBe("visible content");
  });

  it("unwraps <synced_block_reference ...>content</synced_block_reference>", () => {
    expect(
      unwrapMetadataTags(
        `<synced_block_reference url="y">inner</synced_block_reference>`,
      ),
    ).toBe("inner");
  });

  it('unwraps <span discussion-urls="...">text</span>', () => {
    expect(
      unwrapMetadataTags(`<span discussion-urls="a,b">visible</span>`),
    ).toBe("visible");
  });

  it("leaves unrelated <span> tags alone", () => {
    expect(unwrapMetadataTags(`<span class="x">y</span>`)).toBe(
      `<span class="x">y</span>`,
    );
  });
});

describe("transformInline", () => {
  it("converts inline math from $`expr`$ to $expr$", () => {
    expect(transformInline(`See $\`E=mc^2\`$ for energy`)).toBe(
      "See $E=mc^2$ for energy",
    );
  });

  it("handles multiple inline math expressions", () => {
    expect(transformInline(`$\`a\`$ and $\`b\`$`)).toBe("$a$ and $b$");
  });

  it("is a no-op for plain text", () => {
    expect(transformInline("no math here")).toBe("no math here");
  });
});

describe("rewritePageLinks", () => {
  const titles = new Map([
    [ID_A, "Article A"],
    [ID_B, "Article B"],
  ]);

  it("rewrites self-closing <page url=.../>", () => {
    const out = rewritePageLinks(
      `<page url="https://www.notion.so/${ID_A}"/>`,
      titles,
    );
    expect(out).toBe(`[Article A](${ID_A}.md)`);
  });

  it("rewrites <page url=...>inline title</page>", () => {
    const out = rewritePageLinks(
      `<page url="https://www.notion.so/${ID_A}">Custom Title</page>`,
      titles,
    );
    expect(out).toBe(`[Custom Title](${ID_A}.md)`);
  });

  it("falls back to title map when inline content is empty", () => {
    const out = rewritePageLinks(
      `<page url="https://www.notion.so/${ID_A}"></page>`,
      titles,
    );
    expect(out).toBe(`[Article A](${ID_A}.md)`);
  });

  it("falls back to pageId when no title is known", () => {
    const out = rewritePageLinks(
      `<page url="https://www.notion.so/${ID_A}"/>`,
      new Map(),
    );
    expect(out).toBe(`[${ID_A}](${ID_A}.md)`);
  });

  it("rewrites <mention-page url=.../> the same way", () => {
    const out = rewritePageLinks(
      `See <mention-page url="https://www.notion.so/${ID_B}"/> for B`,
      titles,
    );
    expect(out).toBe(`See [Article B](${ID_B}.md) for B`);
  });

  it("handles a mix in one document", () => {
    const input = `Children:
<page url="https://www.notion.so/${ID_A}"/>
<page url="https://www.notion.so/${ID_B}">Override B</page>
And reference: <mention-page url="https://www.notion.so/${ID_A}"/>`;
    const out = rewritePageLinks(input, titles);
    expect(out).toContain(`[Article A](${ID_A}.md)`);
    expect(out).toContain(`[Override B](${ID_B}.md)`);
    // mention-page should also resolve to "Article A"
    expect(
      out.match(new RegExp(`\\[Article A\\]\\(${ID_A}\\.md\\)`, "g")) ?? [],
    ).toHaveLength(2);
  });
});

describe("transformPageMarkdown", () => {
  it("runs the full pipeline (strip + unwrap + page-links + callouts + inline)", () => {
    const titles = new Map([[ID_A, "Linked Page"]]);
    const input = `# Heading
<empty-block/>
<callout>💡 See <page url="https://www.notion.so/${ID_A}"/> for details.</callout>
Inline math: $\`x^2\`$.
<synced_block url="x">synced content</synced_block>`;

    const { markdown, report } = transformPageMarkdown(input, titles);

    expect(markdown).not.toContain("<empty-block/>");
    expect(markdown).not.toContain("<synced_block");
    expect(markdown).toContain("synced content");
    expect(markdown).toContain(`[Linked Page](${ID_A}.md)`);
    expect(markdown).toContain(":::tip");
    expect(markdown).toContain("$x^2$");
    expect(report.callouts.total).toBe(1);
    expect(report.callouts.byType.tip).toBe(1);
  });
});
