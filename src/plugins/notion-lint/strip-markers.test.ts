import { describe, expect, it } from "vitest";
import { stripNotionLintMarkers } from "./strip-markers.ts";

function makeJsxMarker(value: string) {
  return {
    type: "mdxJsxFlowElement",
    name: "div",
    attributes: [
      { type: "mdxJsxAttribute", name: "data-notion-lint", value },
    ],
    children: [{ type: "text", value: "⚠️ marker" }],
  };
}

function makeInlineJsxMarker() {
  return {
    type: "mdxJsxTextElement",
    name: "span",
    attributes: [
      { type: "mdxJsxAttribute", name: "data-notion-lint", value: "broken-link" },
      { type: "mdxJsxAttribute", name: "data-target", value: "abc" },
    ],
    children: [{ type: "text", value: "⚠️ broken link" }],
  };
}

function makeNormalParagraph() {
  return {
    type: "paragraph",
    children: [{ type: "text", value: "regular content" }],
  };
}

describe("stripNotionLintMarkers", () => {
  it("removes JSX flow elements with data-notion-lint", () => {
    const tree = {
      type: "root",
      children: [
        makeNormalParagraph(),
        makeJsxMarker("missing-image"),
        makeJsxMarker("truncated"),
        makeNormalParagraph(),
      ],
    };
    stripNotionLintMarkers()(tree);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.every((c: { type: string }) => c.type === "paragraph")).toBe(true);
  });

  it("removes inline JSX text elements with data-notion-lint", () => {
    const paragraph = {
      type: "paragraph",
      children: [
        { type: "text", value: "before " },
        makeInlineJsxMarker(),
        { type: "text", value: " after" },
      ],
    };
    const tree = { type: "root", children: [paragraph] };
    stripNotionLintMarkers()(tree);
    expect(paragraph.children).toHaveLength(2);
    expect(paragraph.children.map((c) => (c as { value?: string }).value)).toEqual([
      "before ",
      " after",
    ]);
  });

  it("removes raw HTML nodes containing data-notion-lint=", () => {
    const tree = {
      type: "root",
      children: [
        makeNormalParagraph(),
        {
          type: "html",
          value: '<div data-notion-lint="missing-image">…</div>',
        },
        makeNormalParagraph(),
      ],
    };
    stripNotionLintMarkers()(tree);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.every((c: { type: string }) => c.type === "paragraph")).toBe(true);
  });

  it("leaves JSX elements without the sentinel attribute alone", () => {
    const innocent = {
      type: "mdxJsxFlowElement",
      name: "div",
      attributes: [{ type: "mdxJsxAttribute", name: "className", value: "foo" }],
      children: [],
    };
    const tree = { type: "root", children: [innocent] };
    stripNotionLintMarkers()(tree);
    expect(tree.children).toHaveLength(1);
  });

  it("leaves HTML nodes without the sentinel alone", () => {
    const innocent = {
      type: "html",
      value: '<div class="ok">content</div>',
    };
    const tree = { type: "root", children: [innocent] };
    stripNotionLintMarkers()(tree);
    expect(tree.children).toHaveLength(1);
  });

  it("recurses into nested children (admonition wrapper, etc.)", () => {
    const wrapper = {
      type: "containerDirective",
      name: "info",
      children: [
        makeNormalParagraph(),
        makeJsxMarker("broken-link"),
      ],
    };
    const tree = { type: "root", children: [wrapper] };
    stripNotionLintMarkers()(tree);
    expect(wrapper.children).toHaveLength(1);
  });

  it("is idempotent (no markers → no-op)", () => {
    const tree = {
      type: "root",
      children: [makeNormalParagraph(), makeNormalParagraph()],
    };
    const before = JSON.stringify(tree);
    stripNotionLintMarkers()(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
