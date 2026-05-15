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

// Per transforms-plan §3: callout type is signalled by (in priority order)
// the icon attribute, the color attribute, then the body's leading emoji.

const EMOJI_TO_TYPE: Array<[RegExp, string]> = [
  [/^(💡|🟢|✅)/u, "tip"],
  [/^(⚠️|🟡|🟠)/u, "warning"],
  [/^(🔥|❌|🛑|🚫|🔴)/u, "danger"],
  [/^(❗|⚡|🚨)/u, "caution"],
  [/^(ℹ️|📘|📋|🔵|📝)/u, "info"],
];

const LEADING_EMOJI_RE =
  /^[\p{Emoji_Presentation}\p{Extended_Pictographic}️]+\s*/u;

function matchEmojiType(text: string): string | undefined {
  for (const [re, type] of EMOJI_TO_TYPE) {
    if (re.test(text)) return type;
  }
  return undefined;
}

/** Notion callout `icon` attribute → admonition type. Only matches emoji icons; returns undefined for `external:` or `custom:` icons. */
function iconToType(icon: string | null): string | undefined {
  if (!icon) return undefined;
  return matchEmojiType(icon);
}

/** Notion callout `color` attribute → admonition type. */
function colorToType(color: string | null): string | undefined {
  if (!color) return undefined;
  const normalized = color.replace(/_(bg|background)$/, "").toLowerCase();
  switch (normalized) {
    case "gray":
      return "note";
    case "blue":
      return "info";
    case "yellow":
      return "warning";
    case "red":
      return "danger";
    case "green":
      return "tip";
    case "orange":
      return "caution";
    default:
      return undefined;
  }
}

/** Body's leading emoji (a Notion editorial convention) → admonition type. */
function bodyToType(body: string): string | undefined {
  return matchEmojiType(body.trimStart());
}

type CalloutSignals = {
  icon: string | null;
  color: string | null;
  body: string;
};

function detectCalloutType(signals: CalloutSignals): string {
  return (
    iconToType(signals.icon) ??
    colorToType(signals.color) ??
    bodyToType(signals.body) ??
    "note"
  );
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
  const callouts = root
    .querySelectorAll("callout")
    .sort((a, b) => depthOf(b) - depthOf(a));
  for (const el of callouts) {
    const raw = el.innerHTML;
    const type = detectCalloutType({
      icon: el.getAttribute("icon") ?? null,
      color: el.getAttribute("color") ?? null,
      body: raw,
    });
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
