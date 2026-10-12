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

describe("transformPageMarkdown — custom emoji lint", () => {
  it("wraps a custom emoji shortcode in a lint marker", () => {
    expect(transform("Tap the :app-icon-camera: button")).toBe(
      'Tap the <span data-notion-lint="custom-emoji" data-name="app-icon-camera">:app-icon-camera:</span> button',
    );
  });

  it("matches multiple shortcodes on one line", () => {
    const out = transform("Use :android: or :right-toggle:");
    expect(out).toContain('data-name="android"');
    expect(out).toContain('data-name="right-toggle"');
  });

  it("does not match `http://`", () => {
    expect(transform("Visit http://example.com today")).toBe(
      "Visit http://example.com today",
    );
  });

  it("does not match clock times like `9:00`", () => {
    expect(transform("Meeting at 9:00 AM")).toBe("Meeting at 9:00 AM");
  });

  it("does not match `mailto:foo@bar`", () => {
    expect(transform("Email mailto:foo@bar.com please")).toBe(
      "Email mailto:foo@bar.com please",
    );
  });

  it("does not match a bare colon-name without closing colon", () => {
    expect(transform("This :name has no end")).toBe("This :name has no end");
  });
});

describe("transformPageMarkdown — <summary> inline markdown", () => {
  it("converts **bold** inside summary to <strong>", () => {
    expect(
      transform(`<details><summary>**Step by step**</summary>body</details>`),
    ).toContain("<summary><strong>Step by step</strong></summary>");
  });

  it("converts ***bold-italic*** to <strong><em>", () => {
    expect(
      transform(`<details><summary>***Important***</summary>body</details>`),
    ).toContain("<summary><strong><em>Important</em></strong></summary>");
  });

  it("converts *italic* to <em>", () => {
    expect(
      transform(`<details><summary>some *italic* word</summary>body</details>`),
    ).toContain("<summary>some <em>italic</em> word</summary>");
  });

  it("converts `code` to <code> and protects its contents from further substitution", () => {
    expect(
      transform(
        `<details><summary>Use \`**not bold**\` here</summary>body</details>`,
      ),
    ).toContain("<summary>Use <code>**not bold**</code> here</summary>");
  });

  it("converts [link](url) to <a>", () => {
    expect(
      transform(
        `<details><summary>See [docs](https://x.test/a) for more</summary>body</details>`,
      ),
    ).toContain(
      '<summary>See <a href="https://x.test/a">docs</a> for more</summary>',
    );
  });

  it("HTML-escapes `&` and `\"` in link URLs", () => {
    expect(
      transform(
        `<details><summary>[q](https://x.test/?a=1&b=2)</summary>body</details>`,
      ),
    ).toContain('href="https://x.test/?a=1&amp;b=2"');
  });

  it("converts ~~strike~~ to <del>", () => {
    expect(
      transform(`<details><summary>~~old name~~</summary>body</details>`),
    ).toContain("<summary><del>old name</del></summary>");
  });

  it("leaves plain summary text alone", () => {
    expect(
      transform(`<details><summary>Plain text</summary>body</details>`),
    ).toContain("<summary>Plain text</summary>");
  });

  it("preserves existing inline HTML like <br/>", () => {
    expect(
      transform(`<details><summary>**a**<br/>b</summary>body</details>`),
    ).toContain("<summary><strong>a</strong><br/>b</summary>");
  });
});

describe("transformPageMarkdown — blank line between paragraph blocks", () => {
  it("inserts a blank line between two paragraph lines", () => {
    expect(transform("para one\npara two")).toBe("para one\n\npara two");
  });

  it("leaves consecutive bullet list items alone", () => {
    expect(transform("- a\n- b\n- c")).toBe("- a\n- b\n- c");
  });

  it("leaves consecutive numbered list items alone", () => {
    expect(transform("1. a\n2. b\n3. c")).toBe("1. a\n2. b\n3. c");
  });

  it("leaves consecutive blockquote lines alone", () => {
    expect(transform("> a\n> b")).toBe("> a\n> b");
  });

  it("leaves consecutive pipe-table rows alone", () => {
    const input = "| h |\n| --- |\n| a |\n| b |";
    expect(transform(input)).toBe(input);
  });

  it("does not insert inside fenced code blocks", () => {
    const input = "```\nline 1\nline 2\n```";
    expect(transform(input)).toBe(input);
  });

  it("does not insert before an indented continuation", () => {
    expect(transform("- item\n  continuation")).toBe(
      "- item\n  continuation",
    );
    expect(transform("text\n\ttabbed")).toBe("text\n\ttabbed");
  });

  it("inserts blank between paragraph and a divider", () => {
    expect(transform("para\n---\nmore")).toBe("para\n\n---\n\nmore");
  });

  it("splits a Notion-serialised step list inside :::note", () => {
    const input =
      "<callout color=\"gray_bg\">**Step by Step**\n\t***Step 1:*** First\n\t***Step 2:*** Second\n\t***Step 3:*** Third</callout>";
    const out = transform(input);
    expect(out).toContain(":::note");
    expect(out).toContain("**Step by Step**\n\n***Step 1:*** First");
    expect(out).toContain("***Step 1:*** First\n\n***Step 2:*** Second");
    expect(out).toContain("***Step 2:*** Second\n\n***Step 3:*** Third");
  });
});

describe("transformPageMarkdown — tables", () => {
  it("converts a basic table with header-row to a pipe table", () => {
    const input = `<table header-row="true">
<tr><td>Name</td><td>Use</td></tr>
<tr><td>Camera</td><td>Photos</td></tr>
</table>`;
    const out = transform(input).trim();
    expect(out).toBe(
      `| Name | Use |\n| --- | --- |\n| Camera | Photos |`,
    );
  });

  it("preserves markdown formatting inside cells", () => {
    const input = `<table header-row="true">
<tr><td>**Bold header**</td></tr>
<tr><td>*italic* and [link](u)</td></tr>
</table>`;
    const out = transform(input);
    expect(out).toContain("| **Bold header** |");
    expect(out).toContain("| *italic* and [link](u) |");
  });

  it("synthesizes an empty header row when none declared", () => {
    const input = `<table>
<tr><td>a</td><td>b</td></tr>
<tr><td>c</td><td>d</td></tr>
</table>`;
    const out = transform(input).trim();
    expect(out).toBe(
      `|  |  |\n| --- | --- |\n| a | b |\n| c | d |`,
    );
  });

  it("escapes `|` inside cells", () => {
    const input = `<table header-row="true"><tr><td>a|b</td></tr></table>`;
    expect(transform(input)).toContain("| a\\|b |");
  });

  it("collapses newlines inside cells to a single space", () => {
    const input = `<table header-row="true"><tr><td>line1\nline2</td></tr></table>`;
    expect(transform(input)).toContain("| line1 line2 |");
  });

  it("drops column widths and color attributes silently", () => {
    const input = `<table header-row="true">
<colgroup><col width="100"/><col width="200"/></colgroup>
<tr color="red_bg"><td color="blue">A</td><td>B</td></tr>
</table>`;
    const out = transform(input);
    expect(out).not.toContain("colgroup");
    expect(out).not.toContain("width=");
    expect(out).not.toContain("color=");
    expect(out).toContain("| A | B |");
  });

  it("pads short rows so column counts match", () => {
    const input = `<table header-row="true">
<tr><td>a</td><td>b</td><td>c</td></tr>
<tr><td>d</td></tr>
</table>`;
    const out = transform(input);
    expect(out).toContain("| a | b | c |");
    expect(out).toContain("| d |  |  |");
  });

  it("drops a <table> with no rows", () => {
    expect(transform(`Before<table></table>After`).trim()).toBe("BeforeAfter");
  });

  it("converts a table inside a callout (table runs first)", () => {
    const input = `<callout icon="💡"><table header-row="true"><tr><td>A</td></tr><tr><td>B</td></tr></table></callout>`;
    const out = transform(input);
    expect(out).toContain(":::tip");
    expect(out).toContain("| A |");
    expect(out).toContain("| B |");
  });
});

describe("transformPageMarkdown — mention tag strip", () => {
  it("strips <mention-date/>", () => {
    expect(transform(`Before <mention-date start="2026-06-01"/> After`)).toBe(
      "Before  After",
    );
  });

  it("strips <mention-user/>, <mention-database/>, <mention-data-source/>, <mention-agent/>", () => {
    expect(transform(`a<mention-user url="x"/>b`)).toBe("ab");
    expect(transform(`a<mention-database url="x"/>b`)).toBe("ab");
    expect(transform(`a<mention-data-source url="x"/>b`)).toBe("ab");
    expect(transform(`a<mention-agent url="x"/>b`)).toBe("ab");
  });

  it("leaves <mention-page/> alone (handled by page-link rewrite)", () => {
    const id = "00112233445566778899aabbccddeeff";
    const titles = new Map([[id, "T"]]);
    expect(
      transform(`a<mention-page url="https://www.notion.so/${id}"/>b`, titles),
    ).toBe(`a[T](${id}.md)b`);
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

describe("transformPageMarkdown — bold whitespace fixup", () => {
  it("moves trailing whitespace out of **…**", () => {
    expect(transform("**Step 3: **Select Manage apps")).toBe(
      "**Step 3:** Select Manage apps",
    );
  });

  it("moves trailing whitespace out of ***…***", () => {
    expect(transform("\t***Step 2: ***Choose a category.")).toBe(
      "\t***Step 2:*** Choose a category.",
    );
  });

  it("moves leading whitespace out of **…**", () => {
    expect(transform("[link](u)**  t**o learn")).toBe("[link](u)  **t**o learn");
  });

  it("collapses whitespace-only **…**", () => {
    expect(transform("[link](u)** **after")).toBe("[link](u) after");
  });

  it("leaves correctly-formed **…** alone", () => {
    expect(transform("**Tip:** Use the search bar")).toBe(
      "**Tip:** Use the search bar",
    );
    expect(transform("A **Track** records movement.")).toBe(
      "A **Track** records movement.",
    );
  });

  it("handles two trailing-space bolds in one line", () => {
    expect(transform("**Cancel **to stay; **Stop **to proceed")).toBe(
      "**Cancel** to stay; **Stop** to proceed",
    );
  });

  it("moves trailing <br/> out of the bold", () => {
    expect(transform("**Miscellaneous <br/>**[link]")).toBe(
      "**Miscellaneous** <br/>[link]",
    );
  });

  it("moves multiple trailing <br/> out of the bold", () => {
    expect(transform("**Data Privacy & Security<br/><br/>**[link]")).toBe(
      "**Data Privacy & Security**<br/><br/>[link]",
    );
  });

  it("strips bold that contains only <br/>", () => {
    expect(transform("a**<br/>**b")).toBe("a<br/>b");
  });

  it("handles mixed whitespace and <br/> as trailing ignorable", () => {
    expect(transform("**Title <br/> **rest")).toBe("**Title** <br/> rest");
  });
});

describe("transformPageMarkdown — thematic break gap", () => {
  it("adds a blank line before `---` when preceded by text", () => {
    expect(transform("Paragraph text.\n---\nNext paragraph")).toBe(
      "Paragraph text.\n\n---\n\nNext paragraph",
    );
  });

  it("leaves `---` with a blank line before alone (still inserts after)", () => {
    expect(transform("Paragraph.\n\n---\nNext")).toBe(
      "Paragraph.\n\n---\n\nNext",
    );
  });

  it("separates multiple dividers and their surrounding paragraphs", () => {
    expect(transform("A\n---\nB\n---\nC")).toBe(
      "A\n\n---\n\nB\n\n---\n\nC",
    );
  });

  it("handles `***` and `___` thematic breaks too", () => {
    expect(transform("a\n***\nb")).toBe("a\n\n***\n\nb");
    expect(transform("a\n___\nb")).toBe("a\n\n___\n\nb");
  });

  it("inserts a blank after a leading `---` (no preceding line)", () => {
    expect(transform("---\nfirst")).toBe("---\n\nfirst");
  });

  it("handles a trailing `---` with no newline after", () => {
    expect(transform("text\n---")).toBe("text\n\n---");
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
