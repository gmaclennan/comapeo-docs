import { describe, expect, it } from "vitest";
import { transformPageMarkdown } from "./transform.ts";

const ID_A = "00112233445566778899aabbccddeeff";
const ID_B = "112233445566778899aabbccddeeff00";

function transform(md: string, titles: Map<string, string> = new Map()) {
  return transformPageMarkdown(md, titles);
}

describe("transformPageMarkdown — callouts", () => {
  it("converts a callout with no emoji to :::note", () => {
    const out = transform("<callout>Plain text</callout>");
    expect(out).toContain(":::note");
    expect(out).toContain("Plain text");
  });

  it("maps emoji prefixes to admonition types", () => {
    expect(transform("<callout>💡 helpful</callout>")).toContain(":::tip");
    expect(transform("<callout>⚠️ careful</callout>")).toContain(":::warning");
    expect(transform("<callout>🔥 danger</callout>")).toContain(":::danger");
    expect(transform("<callout>❗ caution</callout>")).toContain(":::caution");
    expect(transform("<callout>ℹ️ info</callout>")).toContain(":::info");
  });

  it("strips the leading emoji from the body", () => {
    const out = transform("<callout>💡 Use the search bar</callout>");
    expect(out).not.toMatch(/💡/);
    expect(out).toContain("Use the search bar");
  });

  it("handles multiple callouts in one document", () => {
    const out = transform(
      "<callout>💡 first</callout>\n\n<callout>⚠️ second</callout>",
    );
    expect(out).toContain(":::tip");
    expect(out).toContain(":::warning");
  });

  it("converts nested callouts (innermost first)", () => {
    const out = transform(
      "<callout>💡 outer\n<callout>⚠️ inner</callout>\nback to outer</callout>",
    );
    const tip = out.indexOf(":::tip");
    const warning = out.indexOf(":::warning");
    expect(tip).toBeGreaterThanOrEqual(0);
    expect(warning).toBeGreaterThan(tip);
  });

  it("leaves prose with no callouts unchanged", () => {
    expect(transform("# Heading\n\nSome paragraph.")).toBe(
      "# Heading\n\nSome paragraph.",
    );
  });

  it("uses icon attribute when body has no leading emoji", () => {
    const out = transform(`<callout icon="💡" color="gray_bg">**Tip:** Use the search bar</callout>`);
    expect(out).toContain(":::tip");
    expect(out).toContain("**Tip:**");
  });

  it("falls back to color attribute when icon is non-emoji or absent", () => {
    expect(transform(`<callout color="blue_bg">Heads up</callout>`)).toContain(
      ":::info",
    );
    expect(transform(`<callout color="red_background">Danger</callout>`)).toContain(
      ":::danger",
    );
    expect(transform(`<callout color="yellow">Watch out</callout>`)).toContain(
      ":::warning",
    );
  });

  it("icon attribute wins over color attribute", () => {
    const out = transform(`<callout icon="💡" color="red_bg">Mixed signals</callout>`);
    expect(out).toContain(":::tip");
  });

  it("falls back to body emoji when icon/color give no signal", () => {
    expect(transform(`<callout>💡 from body</callout>`)).toContain(":::tip");
  });

  it("ignores non-emoji icons (external:, custom:)", () => {
    expect(
      transform(`<callout icon="external:https://example.com/x.png">Body</callout>`),
    ).toContain(":::note");
  });
});

describe("transformPageMarkdown — strip / unwrap", () => {
  it("removes <empty-block/>", () => {
    expect(transform("a<empty-block/>b")).toBe("ab");
  });

  it("removes <table_of_contents .../>", () => {
    expect(
      transform(`Before<table_of_contents color="default" />After`),
    ).toBe("BeforeAfter");
  });

  it("removes <unknown ... alt=...>", () => {
    expect(transform(`x<unknown id="y" alt="button"/>z`)).toBe("xz");
  });

  it("unwraps <synced_block>content</synced_block>", () => {
    expect(transform(`<synced_block url="x">visible</synced_block>`)).toBe(
      "visible",
    );
  });

  it("unwraps <synced_block_reference>", () => {
    expect(
      transform(
        `<synced_block_reference url="y">inner</synced_block_reference>`,
      ),
    ).toBe("inner");
  });

  it("unwraps <span discussion-urls=...>", () => {
    expect(transform(`<span discussion-urls="a,b">visible</span>`)).toBe(
      "visible",
    );
  });

  it("leaves unrelated <span> tags alone", () => {
    expect(transform(`<span class="x">y</span>`)).toBe(`<span class="x">y</span>`);
  });
});

describe("transformPageMarkdown — inline fixups", () => {
  it("converts inline math from $`expr`$ to $expr$", () => {
    expect(transform("See $`E=mc^2`$ for energy")).toBe(
      "See $E=mc^2$ for energy",
    );
  });

  it("handles multiple inline math expressions", () => {
    expect(transform("$`a`$ and $`b`$")).toBe("$a$ and $b$");
  });

  it("strips empty markdown image refs", () => {
    expect(transform("Before ![](  ) After")).toBe("Before  After");
    expect(transform("![alt]()")).toBe("");
  });

  it("self-closes HTML void elements for MDX", () => {
    expect(transform("Line 1<br>Line 2")).toBe("Line 1<br/>Line 2");
    expect(transform("<hr>")).toBe("<hr/>");
    expect(transform(`<col span="2">`)).toBe(`<col span="2"/>`);
  });

  it("leaves already self-closed void elements alone", () => {
    expect(transform("<br/>")).toBe("<br/>");
  });
});

describe("transformPageMarkdown — page link rewriting", () => {
  const titles = new Map([
    [ID_A, "Article A"],
    [ID_B, "Article B"],
  ]);

  it("rewrites self-closing <page url=.../>", () => {
    expect(
      transform(`<page url="https://www.notion.so/${ID_A}"/>`, titles),
    ).toBe(`[Article A](${ID_A}.md)`);
  });

  it("rewrites <page url=...>inline title</page>", () => {
    expect(
      transform(
        `<page url="https://www.notion.so/${ID_A}">Custom Title</page>`,
        titles,
      ),
    ).toBe(`[Custom Title](${ID_A}.md)`);
  });

  it("falls back to title map when inline content is empty", () => {
    expect(
      transform(`<page url="https://www.notion.so/${ID_A}"></page>`, titles),
    ).toBe(`[Article A](${ID_A}.md)`);
  });

  it("falls back to pageId when no title is known", () => {
    expect(
      transform(`<page url="https://www.notion.so/${ID_A}"/>`, new Map()),
    ).toBe(`[${ID_A}](${ID_A}.md)`);
  });

  it("rewrites <mention-page url=.../>", () => {
    expect(
      transform(
        `See <mention-page url="https://www.notion.so/${ID_B}"/> for details`,
        titles,
      ),
    ).toBe(`See [Article B](${ID_B}.md) for details`);
  });

  it("handles a mix in one document", () => {
    const input = `Children:
<page url="https://www.notion.so/${ID_A}"/>
<page url="https://www.notion.so/${ID_B}">Override B</page>
And reference: <mention-page url="https://www.notion.so/${ID_A}"/>`;
    const out = transform(input, titles);
    expect(out).toContain(`[Article A](${ID_A}.md)`);
    expect(out).toContain(`[Override B](${ID_B}.md)`);
    expect(out.match(new RegExp(`\\[Article A\\]\\(${ID_A}\\.md\\)`, "g")))
      .toHaveLength(2);
  });
});

describe("transformPageMarkdown — end-to-end", () => {
  it("runs all transforms in correct order on a mixed document", () => {
    const titles = new Map([[ID_A, "Linked"]]);
    const input = `# Heading
<empty-block/>
<callout>💡 See <page url="https://www.notion.so/${ID_A}"/> for details.</callout>
Inline math: $\`x^2\`$.
<synced_block url="x">synced content</synced_block>
A line<br>then another`;

    const out = transform(input, titles);

    expect(out).not.toContain("<empty-block/>");
    expect(out).not.toContain("<synced_block");
    expect(out).toContain("synced content");
    expect(out).toContain(`[Linked](${ID_A}.md)`);
    expect(out).toContain(":::tip");
    expect(out).toContain("$x^2$");
    expect(out).toContain("<br/>");
  });
});
