// Notion Enhanced Markdown → Docusaurus-friendly Markdown transforms.
//
// HTML-like tags (Notion's serialisation of block types) are transformed via
// node-html-parser. The parser handles attribute quoting, nesting, and
// whitespace correctly — much more robust than chained regex.
//
// Pure markdown-only fixups (inline math, void-element self-closing, empty
// image refs) stay as regex: they don't touch tag structure.

import { parse, type HTMLElement } from "node-html-parser";
import { LINT_ATTRIBUTE } from "./lint-markers.ts";

const STRIP_TAGS = [
  "empty-block",
  "table_of_contents",
  "unknown",
  // Unhandled mention types: dates, users, databases, data sources, agents.
  // `<mention-page>` is rewritten separately by rewritePageElements.
  "mention-date",
  "mention-user",
  "mention-database",
  "mention-data-source",
  "mention-agent",
];
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

  // Convert HTML <table> to GFM pipe-table. Run BEFORE callouts so a table
  // nested inside a callout is already pipe-table text when the callout
  // walker reads innerHTML. Markdown inside <td> (bold, links) only renders
  // once cells become pipe-table cells.
  for (const table of root.querySelectorAll("table")) {
    table.replaceWith(convertTableToPipeTable(table));
  }

  // MDX parses <summary> children as JSX text — markdown like `**bold**`
  // stays literal. Pre-render inline markdown to inline HTML so the
  // disclosure header reads correctly.
  for (const summary of root.querySelectorAll("summary")) {
    summary.replaceWith(`<summary>${inlineMdToInlineHtml(summary.innerHTML)}</summary>`);
  }

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
    // Strip one level of tab/space indent from each body line. Notion
    // serializes the children of a <callout> with one tab of indent; once
    // wrapped in :::admonition markers that indent is no longer structural,
    // and would otherwise turn each line into an indented code block once
    // ensureBlankBetweenParagraphLines runs.
    const body = dedentOneLevel(stripLeadingEmoji(raw).trim());
    el.replaceWith(`\n:::${type}\n\n${body}\n\n:::\n`);
  }

  return root.toString();
}

// === Inline markdown → inline HTML (for <summary>) =======================

// Order: code spans first (their contents are verbatim — protect from
// further substitution by tokenising and applying transforms only to the
// surrounding text), then links, strikethrough, ***bold-italic***, **bold**,
// __bold__, *italic*, _italic_. Single-line scope: `[^*\n]` etc. keeps these
// from running across line boundaries (summary contents are normally one line).

const CODE_SPAN_RE = /`([^`]+)`/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const STRIKETHROUGH_RE = /~~(.+?)~~/g;
const BOLD_ITALIC_AST_RE = /\*\*\*([^*\n]+?)\*\*\*/g;
const BOLD_AST_RE = /\*\*([^*\n]+?)\*\*/g;
const BOLD_UND_RE = /__([^_\n]+?)__/g;
const ITALIC_AST_RE = /(?<![*\w])\*([^*\n]+?)\*(?!\*)/g;
const ITALIC_UND_RE = /(?<![_\w])_([^_\n]+?)_(?!_)/g;

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function applyNonCodeInlineTransforms(text: string): string {
  let out = text;
  out = out.replace(LINK_RE, (_m, label: string, url: string) =>
    `<a href="${escapeHtmlAttr(url)}">${label}</a>`,
  );
  out = out.replace(STRIKETHROUGH_RE, "<del>$1</del>");
  out = out.replace(BOLD_ITALIC_AST_RE, "<strong><em>$1</em></strong>");
  out = out.replace(BOLD_AST_RE, "<strong>$1</strong>");
  out = out.replace(BOLD_UND_RE, "<strong>$1</strong>");
  out = out.replace(ITALIC_AST_RE, "<em>$1</em>");
  out = out.replace(ITALIC_UND_RE, "<em>$1</em>");
  return out;
}

function inlineMdToInlineHtml(text: string): string {
  const parts: string[] = [];
  let lastIdx = 0;
  for (const match of text.matchAll(CODE_SPAN_RE)) {
    const idx = match.index!;
    parts.push(applyNonCodeInlineTransforms(text.slice(lastIdx, idx)));
    parts.push(`<code>${match[1]}</code>`);
    lastIdx = idx + match[0].length;
  }
  parts.push(applyNonCodeInlineTransforms(text.slice(lastIdx)));
  return parts.join("");
}

// === Tables ==============================================================

// Notion's Markdown API emits HTML tables (`<table><tr><td>**bold**</td>`),
// which MDX renders structurally but does NOT parse markdown inside cells —
// `**bold**` stays literal. Convert to GFM pipe tables so remark-gfm parses
// cell contents. Drops column widths and per-cell/row colors (no GFM
// equivalent) — matches the legacy notion-to-md behavior.
function convertTableToPipeTable(table: HTMLElement): string {
  const rows = table.querySelectorAll("tr");
  if (rows.length === 0) return "";

  const cellRows: string[][] = rows.map((row) =>
    row
      .querySelectorAll("td, th")
      .map((cell) =>
        cell.innerHTML
          .trim()
          .replace(/\|/g, "\\|")
          .replace(/\r?\n+/g, " "),
      ),
  );

  const maxCols = Math.max(...cellRows.map((r) => r.length));
  for (const r of cellRows) {
    while (r.length < maxCols) r.push("");
  }

  const hasHeaderRow =
    table.getAttribute("header-row") === "true" ||
    rows[0].querySelectorAll("th").length > 0;

  const header = hasHeaderRow
    ? cellRows.shift()!
    : new Array<string>(maxCols).fill("");

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...cellRows.map((row) => `| ${row.join(" | ")} |`),
  ];

  return `\n\n${lines.join("\n")}\n\n`;
}

/** Strip a single level of tab or 1-4 space indent from each line. */
function dedentOneLevel(text: string): string {
  return text.replace(/^(?:\t| {1,4})/gm, "");
}

// === Markdown-only fixups ===============================================

const INLINE_MATH_RE = /\$`([^`]+)`\$/g;
const EMPTY_IMAGE_RE = /!\[[^\]]*\]\(\s*\)/g;
const VOID_ELEMENT_RE =
  /<(br|hr|col|img|wbr|area|base|embed|input|link|meta|source|track)\b([^>]*)(?<!\/)>/gi;
// Notion's serialiser bolds whatever the editor's selection covered — which
// often includes a trailing space, a leading space, or trailing `<br/>` line
// breaks. These render badly: CommonMark won't close `**` preceded by
// whitespace, and even when it does parse, the visual effect (bold space, or
// the line break "inside" the bold) is wrong. Move that ignorable content
// outside the emphasis run; strip the emphasis entirely when nothing
// non-ignorable is left.
const BOLD_RUN_RE = /(\*\*\*|\*\*)((?:(?!\1)[^\n])+?)\1(?!\*)/g;
const LEADING_IGNORABLE_RE = /^(?:[ \t]|<br\s*\/?>)+/i;
const TRAILING_IGNORABLE_RE = /(?:[ \t]|<br\s*\/?>)+$/i;
// Notion emits divider blocks as `---` directly under the preceding
// paragraph, which CommonMark parses as a setext H2 underline — the prior
// paragraph becomes a heading. Insert a blank line so it's parsed as a
// thematic break (<hr>) instead.
const THEMATIC_BREAK_NEEDS_GAP_RE =
  /([^\n])\n( {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*)(?=\n|$)/g;
// Notion custom-emoji shortcodes (`:app-icon-camera:`, `:android:`, etc.)
// don't map to anything in Docusaurus. Negative lookarounds keep `http://`,
// `9:00`, and `mailto:foo` from matching.
const CUSTOM_EMOJI_RE =
  /(?<![a-zA-Z0-9]):([a-zA-Z][a-zA-Z0-9_-]*?):(?![a-zA-Z0-9])/g;
// Notion's API emits one block per line separated by single `\n`. CommonMark
// joins consecutive non-blank lines into a single paragraph with soft breaks
// (rendered as a space). Restore each block as its own paragraph.
const CODE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
const BULLET_LI_RE = /^ {0,3}[-*+]\s/;
const NUMBERED_LI_RE = /^ {0,3}\d+[.)]\s/;
const BLOCKQUOTE_LINE_RE = /^ {0,3}>/;
const TABLE_ROW_RE = /^ {0,3}\|/;
const INDENTED_LINE_RE = /^(?:\t| {4,})/;

/** Notion wraps inline math in backticks: `$\`E=mc^2\`$` → `$E=mc^2$`. */
function transformInlineMath(markdown: string): string {
  return markdown.replace(INLINE_MATH_RE, (_match, expr: string) => `$${expr}$`);
}

/** Strip `![alt]()` image references with empty URLs (deleted attachments). */
function stripEmptyImages(markdown: string): string {
  return markdown.replace(EMPTY_IMAGE_RE, "");
}

/** Insert a blank line between consecutive non-blank lines that don't belong to the same multi-line block (list, quote, table, code fence, indented continuation). */
function ensureBlankBetweenParagraphLines(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    if (CODE_FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const next = lines[i + 1];
    if (next === undefined) continue;
    if (line.trim() === "" || next.trim() === "") continue;

    // Don't insert if the next line is indented: it could be a list-item
    // continuation, an indented code block boundary, or nested HTML — all
    // cases where a blank would change semantics in the wrong direction.
    if (INDENTED_LINE_RE.test(next)) continue;
    // After a list item, any leading whitespace on the next line (even 2-3
    // spaces) signals a continuation paragraph belonging to the same item.
    if (
      (BULLET_LI_RE.test(line) || NUMBERED_LI_RE.test(line)) &&
      /^[ \t]/.test(next)
    ) {
      continue;
    }
    // Same-kind consecutive list items, blockquote lines, and table rows
    // belong to the same block and would become loose lists / separate
    // quotes / split tables if we inserted a blank between them.
    if (BULLET_LI_RE.test(line) && BULLET_LI_RE.test(next)) continue;
    if (NUMBERED_LI_RE.test(line) && NUMBERED_LI_RE.test(next)) continue;
    if (BLOCKQUOTE_LINE_RE.test(line) && BLOCKQUOTE_LINE_RE.test(next)) continue;
    if (TABLE_ROW_RE.test(line) && TABLE_ROW_RE.test(next)) continue;

    out.push("");
  }

  return out.join("\n");
}

/** Wrap each `:custom-emoji:` shortcode in a notion-lint marker so editors are told to remove it. */
function markCustomEmoji(markdown: string): string {
  return markdown.replace(
    CUSTOM_EMOJI_RE,
    (_match, name: string) =>
      `<span ${LINT_ATTRIBUTE}="custom-emoji" data-name="${name}">:${name}:</span>`,
  );
}

/** Ensure a blank line precedes every thematic break so it isn't parsed as a setext heading underline. */
function ensureBlankBeforeThematicBreaks(markdown: string): string {
  return markdown.replace(
    THEMATIC_BREAK_NEEDS_GAP_RE,
    (_match, prev: string, line: string) => `${prev}\n\n${line}`,
  );
}

/** Move whitespace and `<br/>` adjacent to the inside of `**…**` / `***…***` delimiters to the outside; strip emphasis whose content is entirely ignorable. */
function fixBoldInnerWhitespace(markdown: string): string {
  return markdown.replace(BOLD_RUN_RE, (match, open: string, content: string) => {
    const lead = content.match(LEADING_IGNORABLE_RE)?.[0] ?? "";
    const afterLead = content.slice(lead.length);
    const trail = afterLead.match(TRAILING_IGNORABLE_RE)?.[0] ?? "";
    const core = afterLead.slice(0, afterLead.length - trail.length);
    if (!lead && !trail) return match;
    if (!core) return `${lead}${trail}`;
    return `${lead}${open}${core}${open}${trail}`;
  });
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
  out = fixBoldInnerWhitespace(out);
  out = ensureBlankBeforeThematicBreaks(out);
  out = ensureBlankBetweenParagraphLines(out);
  out = selfCloseVoidElements(out);
  out = stripEmptyImages(out);
  out = markCustomEmoji(out);
  return out;
}
