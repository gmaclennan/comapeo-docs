// Remark transformer that strips notion-lint marker nodes from MDAST.
//
// The notion-export pipeline emits visible markers (e.g. `<div data-notion-lint="missing-image">…</div>`)
// for content-quality issues so reviewers see them on the staging preview.
// In production builds we strip them: the lint workflow gates the
// staging→published PR, so the only way a marker reaches the production
// build is if an admin overrides branch protection — this transformer is
// the second line of defence.
//
// Matches both MDX JSX elements (mdxJsxFlowElement / mdxJsxTextElement —
// the normal case with `future.v4: true` strict MDX) and raw HTML nodes
// (fallback for legacy MDX modes).
//
// CONTRACT: markers MUST appear as element nodes in `children` position,
// not inside `mdxJsxAttribute.value` expressions (e.g. as a component
// prop). The walker visits `node.children` only; markers buried in
// attribute-value JSX would slip through. The pipeline never emits this
// shape today (all markers are direct elements), so this is documentation,
// not a known bug.
//
// Pure tree mutation, no I/O. Safe to call on any MDAST root.

type AnyNode = {
  type: string;
  children?: unknown[];
  attributes?: Array<{ type?: string; name?: string }>;
  value?: unknown;
};

const SENTINEL = "data-notion-lint";

function isJsxMarker(node: AnyNode): boolean {
  if (
    node.type !== "mdxJsxFlowElement" &&
    node.type !== "mdxJsxTextElement"
  ) {
    return false;
  }
  if (!Array.isArray(node.attributes)) return false;
  return node.attributes.some((attr) => attr?.name === SENTINEL);
}

function isHtmlMarker(node: AnyNode): boolean {
  if (node.type !== "html") return false;
  return typeof node.value === "string" && node.value.includes(`${SENTINEL}=`);
}

function strip(node: AnyNode): void {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.filter((child) => {
    const c = child as AnyNode;
    return !isJsxMarker(c) && !isHtmlMarker(c);
  });
  for (const child of node.children) {
    strip(child as AnyNode);
  }
}

export function stripNotionLintMarkers() {
  return function transformer(tree: AnyNode): void {
    strip(tree);
  };
}
