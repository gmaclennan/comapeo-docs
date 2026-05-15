// Notion Enhanced Markdown → Docusaurus-friendly Markdown transforms.
//
// HTML-like tags (Notion's serialisation of block types) are transformed via
// node-html-parser. The parser handles attribute quoting, nesting, and
// whitespace correctly — much more robust than chained regex.
//
// Pure markdown-only fixups (inline math, void-element self-closing, empty
// image refs) stay as regex: they don't touch tag structure.

import { parse, type HTMLElement } from "node-html-parser";

const STRIP_TAGS = ["empty-block", "table_of_contents", "unknown"];
const UNWRAP_TAGS = ["synced_block", "synced_block_reference"];
const UNWRAP_SELECTORS = ["span[discussion-urls]"];

const NOTION_PAGE_ID_RE = /([0-9a-f]{32})/i;

// === Callouts ============================================================

const EMOJI_TO_TYPE: Array<[RegExp, string]> = [
  [/^(💡|🟢|✅)/u, "tip"],
  [/^(⚠️|🟡|🟠)/u, "warning"],
  [/^(🔥|❌|🛑|🚫|🔴)/u, "danger"],
  [/^(❗|⚡|🚨)/u, "caution"],
  [/^(ℹ️|📘|📋|🔵|📝)/u, "info"],
];

const LEADING_EMOJI_RE =
  /^[\p{Emoji_Presentation}\p{Extended_Pictographic}️]+\s*/u;

function detectCalloutType(content: string): string {
  const trimmed = content.trimStart();
  for (const [re, type] of EMOJI_TO_TYPE) {
    if (re.test(trimmed)) return type;
  }
  return "note";
}

function stripLeadingEmoji(content: string): string {
  return content.replace(LEADING_EMOJI_RE, "");
}

// === HTML-tag transforms ================================================

function depthOf(el: HTMLElement): number {
  let depth = 0;
  let cursor: HTMLElement | null = el.parentNode;
  while (cursor) {
    depth += 1;
    cursor = cursor.parentNode;
  }
  return depth;
}

function rewritePageElements(
  root: HTMLElement,
  titles: Map<string, string>,
  tag: "page" | "mention-page",
): void {
  for (const el of root.querySelectorAll(tag)) {
    const url = el.getAttribute("url") ?? "";
    const match = url.match(NOTION_PAGE_ID_RE);
    if (!match) continue;
    const id = match[1].toLowerCase();
    const inner = el.innerHTML.trim();
    const label = inner || titles.get(id) || id;
    el.replaceWith(`[${label}](${id}.md)`);
  }
}

function applyHtmlTransforms(
  markdown: string,
  titles: Map<string, string>,
): string {
  const root = parse(markdown, { lowerCaseTagName: false, comment: true });

  // Strip tags that have no rendered counterpart.
  for (const tag of STRIP_TAGS) {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  }

  // Unwrap tags whose inner content is what we want to keep.
  for (const tag of UNWRAP_TAGS) {
    root.querySelectorAll(tag).forEach((el) => el.replaceWith(el.innerHTML));
  }
  for (const sel of UNWRAP_SELECTORS) {
    root.querySelectorAll(sel).forEach((el) => el.replaceWith(el.innerHTML));
  }

  // Rewrite Notion page references to relative MD links. The destination's
  // canonical URL is resolved per-locale by Docusaurus's MD link resolver
  // at build time (see tree-publish-plan §4).
  rewritePageElements(root, titles, "page");
  rewritePageElements(root, titles, "mention-page");

  // Convert callouts to Docusaurus admonitions, innermost first. The
  // depth-descending order ensures inner callouts are already replaced by
  // admonition text by the time we process their outer wrapper.
  //
  // Type detection prefers the `icon` attribute (Notion's signal), then
  // falls back to a leading emoji in the body, then to `note`.
  const callouts = root
    .querySelectorAll("callout")
    .sort((a, b) => depthOf(b) - depthOf(a));
  for (const el of callouts) {
    const raw = el.innerHTML;
    const icon = el.getAttribute("icon") ?? "";
    const type = detectCalloutType(`${icon} ${raw}`);
    const body = stripLeadingEmoji(raw).trim();
    el.replaceWith(`\n:::${type}\n\n${body}\n\n:::\n`);
  }

  return root.toString();
}

// === Markdown-only fixups ===============================================

const INLINE_MATH_RE = /\$`([^`]+)`\$/g;
const EMPTY_IMAGE_RE = /!\[[^\]]*\]\(\s*\)/g;
const VOID_ELEMENT_RE =
  /<(br|hr|col|img|wbr|area|base|embed|input|link|meta|source|track)\b([^>]*)(?<!\/)>/gi;

/** Notion wraps inline math in backticks: `$\`E=mc^2\`$` → `$E=mc^2$`. */
function transformInlineMath(markdown: string): string {
  return markdown.replace(INLINE_MATH_RE, (_match, expr: string) => `$${expr}$`);
}

/** Strip `![alt]()` image references with empty URLs (deleted attachments). */
function stripEmptyImages(markdown: string): string {
  return markdown.replace(EMPTY_IMAGE_RE, "");
}

/** MDX is JSX-strict: HTML void elements need `<br/>` not `<br>`. */
function selfCloseVoidElements(markdown: string): string {
  return markdown.replace(VOID_ELEMENT_RE, (_match, tag: string, rest: string) => {
    const trimmed = rest.trim();
    return trimmed ? `<${tag} ${trimmed}/>` : `<${tag}/>`;
  });
}

// === Public entry =======================================================

/**
 * Apply the full transform pipeline to a page's markdown body.
 *
 * Order matters:
 *   1. HTML-tag transforms (strip → unwrap → page links → callouts)
 *   2. Markdown-only fixups (inline math, void elements, empty images)
 *
 * Image URL processing is NOT here — it lives in images.ts because it has I/O.
 */
export function transformPageMarkdown(
  markdown: string,
  titles: Map<string, string>,
): string {
  let out = applyHtmlTransforms(markdown, titles);
  out = transformInlineMath(out);
  out = selfCloseVoidElements(out);
  out = stripEmptyImages(out);
  return out;
}
