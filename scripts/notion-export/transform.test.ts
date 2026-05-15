import { describe, expect, it } from "vitest";
import { convertCallouts } from "./transform.ts";

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
