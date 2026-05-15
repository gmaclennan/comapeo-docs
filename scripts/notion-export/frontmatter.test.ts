import { describe, expect, it } from "vitest";
import { renderFrontmatter, renderPageFile } from "./frontmatter.ts";

describe("renderFrontmatter", () => {
  it("emits title only when description is omitted", () => {
    const out = renderFrontmatter({ title: "Hello" });
    expect(out).toBe('---\ntitle: "Hello"\n---\n');
  });

  it("emits both title and description when provided", () => {
    const out = renderFrontmatter({
      title: "Hello",
      description: "A doc",
    });
    expect(out).toBe(
      '---\ntitle: "Hello"\ndescription: "A doc"\n---\n',
    );
  });

  it("escapes double quotes in title", () => {
    const out = renderFrontmatter({ title: 'He said "hi"' });
    expect(out).toContain(String.raw`title: "He said \"hi\""`);
  });

  it("escapes backslashes in title", () => {
    const out = renderFrontmatter({ title: "path\\to" });
    expect(out).toContain(String.raw`title: "path\\to"`);
  });

  it("handles emoji in title", () => {
    const out = renderFrontmatter({ title: "💡 Tips" });
    expect(out).toContain(`title: "💡 Tips"`);
  });

  it("emits empty quoted string for empty title", () => {
    const out = renderFrontmatter({ title: "" });
    expect(out).toContain(`title: ""`);
  });

  it("handles titles with YAML special characters safely", () => {
    const out = renderFrontmatter({ title: "A: a [bracket] {brace} & more" });
    // No assertion-on-exact-form; just round-trip safety: the title must
    // be inside double quotes and the quotes must not appear bare in the
    // value.
    expect(out).toMatch(/title: "A: a \[bracket\] \{brace\} & more"/);
  });
});

describe("renderPageFile", () => {
  it("joins frontmatter and trimmed content", () => {
    const out = renderPageFile({ title: "Hello" }, "Body text.\n");
    expect(out).toBe('---\ntitle: "Hello"\n---\nBody text.\n\n');
  });

  it("strips leading whitespace from content", () => {
    const out = renderPageFile({ title: "Hello" }, "\n\n  Body text.");
    expect(out).toBe('---\ntitle: "Hello"\n---\nBody text.\n');
  });
});
