// Notion Enhanced Markdown → Docusaurus-friendly Markdown transforms.
//
// Mostly pass-through: MDX accepts inline HTML, so most Notion tags work as-is.
// This module handles the few patterns that need active conversion (per
// transforms-plan §2 strip/unwrap/transform tables).

const STRIP_TAG_RES: RegExp[] = [
  /<empty-block\s*\/>/g,
  /<table_of_contents\b[^>]*\/>/g,
  /<unknown\b[^>]*\/>/g,
];

const UNWRAP_PATTERNS: Array<{ open: RegExp; close: RegExp }> = [
  // <span discussion-urls="...">text</span>
  {
    open: /<span\s+discussion-urls="[^"]*"\s*>/g,
    close: /<\/span>/g,
  },
];

const SYNCED_BLOCK_RE =
  /<synced_block\b[^>]*>([\s\S]*?)<\/synced_block>/g;
const SYNCED_BLOCK_REF_RE =
  /<synced_block_reference\b[^>]*>([\s\S]*?)<\/synced_block_reference>/g;

const INLINE_MATH_RE = /\$`([^`]+)`\$/g;

const PAGE_TAG_RE =
  /<page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"(?:\s+color="[^"]*")?>([\s\S]*?)<\/page>/g;
const SELF_CLOSING_PAGE_RE =
  /<page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"\s*\/>/g;
const MENTION_PAGE_RE =
  /<mention-page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"\s*\/>/g;

// === CALLOUTS ============================================================

const EMOJI_TO_TYPE: Array<[RegExp, string]> = [
  [/^(💡|🟢|✅)/u, "tip"],
  [/^(⚠️|🟡|🟠)/u, "warning"],
  [/^(🔥|❌|🛑|🚫|🔴)/u, "danger"],
  [/^(❗|⚡|🚨)/u, "caution"],
  [/^(ℹ️|📘|📋|🔵|📝)/u, "info"],
];

const LEADING_EMOJI_RE =
  /^[\p{Emoji_Presentation}\p{Extended_Pictographic}️]+\s*/u;

// Matches an INNERMOST callout: a <callout>...</callout> whose body contains
// no nested <callout> opening tag. The negative lookahead `(?!<callout>)` is
// what excludes nested cases — outer callouts can't match until their inner
// ones have been replaced.
const CALLOUT_TAG_RE = /<callout>((?:(?!<callout>)[\s\S])*?)<\/callout>/g;

export type CalloutReport = {
  total: number;
  byType: Record<string, number>;
};

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

/**
 * Converts Notion <callout>...</callout> tags into Docusaurus admonitions.
 * Recurses through nested callouts (innermost first).
 */
export function convertCallouts(markdown: string): {
  markdown: string;
  report: CalloutReport;
} {
  const report: CalloutReport = { total: 0, byType: {} };

  let current = markdown;
  let passes = 0;
  while (true) {
    CALLOUT_TAG_RE.lastIndex = 0;
    if (!CALLOUT_TAG_RE.test(current)) break;
    if (passes++ > 32) {
      throw new Error(
        "convertCallouts: too many passes (>32); possible malformed callout nesting",
      );
    }
    CALLOUT_TAG_RE.lastIndex = 0;
    current = current.replace(CALLOUT_TAG_RE, (_match, raw: string) => {
      const type = detectCalloutType(raw);
      report.total += 1;
      report.byType[type] = (report.byType[type] ?? 0) + 1;
      const body = stripLeadingEmoji(raw).trim();
      return `\n:::${type}\n\n${body}\n\n:::\n`;
    });
  }

  return { markdown: current, report };
}

// === STRIP / UNWRAP / INLINE =============================================

/**
 * Remove tags that have no rendered counterpart.
 * Per transforms-plan §2: <empty-block/>, <table_of_contents .../>,
 * <unknown ... alt="..."/> (buttons, bookmarks, embeds).
 */
export function stripUnsupportedTags(markdown: string): string {
  let out = markdown;
  for (const re of STRIP_TAG_RES) {
    out = out.replace(re, "");
  }
  return out;
}

/**
 * Unwrap tags whose inner content is what we want to keep.
 * Per transforms-plan §2: <span discussion-urls="...">text</span>,
 * <synced_block ...>...</synced_block>, etc.
 */
export function unwrapMetadataTags(markdown: string): string {
  let out = markdown;

  // synced_block and synced_block_reference: keep inner content
  out = out.replace(SYNCED_BLOCK_RE, (_match, inner: string) => inner);
  out = out.replace(SYNCED_BLOCK_REF_RE, (_match, inner: string) => inner);

  // <span discussion-urls="...">text</span> — keep "text"
  for (const { open, close } of UNWRAP_PATTERNS) {
    out = out.replace(
      new RegExp(`${open.source}([\\s\\S]*?)${close.source}`, "g"),
      (_match, inner: string) => inner,
    );
  }

  return out;
}

/**
 * Inline transforms that don't justify the HTML-parser overhead:
 *   - $`E=mc^2`$ → $E=mc^2$ (Notion wraps inline math in backticks; KaTeX expects no backticks)
 *   - <br> → <br/> (MDX requires JSX self-closing for void HTML elements)
 *   - <hr> → <hr/> (same)
 */
export function transformInline(markdown: string): string {
  let out = markdown.replace(
    INLINE_MATH_RE,
    (_match, expr: string) => `$${expr}$`,
  );
  out = selfCloseVoidElements(out);
  out = stripEmptyImages(out);
  return out;
}

const EMPTY_IMAGE_RE = /!\[[^\]]*\]\(\s*\)/g;

/**
 * Strip `![alt]()` references with empty URLs. Notion sometimes emits these
 * for images that were deleted or never uploaded. MDX rejects them outright
 * even though Docusaurus's `onBrokenMarkdownImages` setting would otherwise
 * downgrade to a warning.
 */
export function stripEmptyImages(markdown: string): string {
  return markdown.replace(EMPTY_IMAGE_RE, "");
}

const VOID_ELEMENT_RE =
  /<(br|hr|col|img|wbr|area|base|embed|input|link|meta|source|track)\b([^>]*)(?<!\/)>/gi;

/**
 * MDX is JSX-strict — HTML void elements (<br>, <hr>) need to be self-closed.
 * Notion emits the HTML form which crashes MDX parsing. Rewrite to JSX form.
 */
export function selfCloseVoidElements(markdown: string): string {
  return markdown.replace(VOID_ELEMENT_RE, (_match, tag: string, rest: string) => {
    const trimmedRest = rest.trim();
    return trimmedRest ? `<${tag} ${trimmedRest}/>` : `<${tag}/>`;
  });
}

// === PAGE LINK REWRITING ================================================

/**
 * Rewrite Notion <page> and <mention-page> tags to relative Markdown
 * links of the form `[title](<pageId>.md)`. Docusaurus's MD link resolver
 * then routes them to the right URL per locale at build time
 * (see tree-publish-plan §4).
 *
 * `titles` maps pageId → title (provided by the orchestrator from the
 * walked tree). Used to resolve self-closing tags that don't carry inline text.
 */
export function rewritePageLinks(
  markdown: string,
  titles: Map<string, string>,
): string {
  let out = markdown;

  // <page url=...>inline title</page> — use inline content if present, else lookup
  out = out.replace(PAGE_TAG_RE, (_match, id: string, inner: string) => {
    const label = inner.trim() || titles.get(id) || id;
    return `[${label}](${id}.md)`;
  });

  // <page url=.../> self-closing — look up title from tree
  out = out.replace(SELF_CLOSING_PAGE_RE, (_match, id: string) => {
    const label = titles.get(id) ?? id;
    return `[${label}](${id}.md)`;
  });

  // <mention-page url=.../> — look up title from tree
  out = out.replace(MENTION_PAGE_RE, (_match, id: string) => {
    const label = titles.get(id) ?? id;
    return `[${label}](${id}.md)`;
  });

  return out;
}

// === ORCHESTRATION ======================================================

export type TransformReport = {
  callouts: CalloutReport;
};

/**
 * Apply the full transform pipeline to a single page's markdown body.
 * Order matters:
 *   1. Strip removable tags (empty-block, table_of_contents, etc.)
 *   2. Unwrap metadata wrappers (synced_block, span[discussion-urls])
 *   3. Rewrite cross-page links (before callouts so links inside callouts get processed)
 *   4. Convert callouts (transforms-plan §3)
 *   5. Inline transforms (math, etc.)
 *
 * Image processing is NOT here — it's separate because it has I/O.
 * The orchestrator calls processImagesInMarkdown() after these transforms.
 */
export function transformPageMarkdown(
  markdown: string,
  titles: Map<string, string>,
): { markdown: string; report: TransformReport } {
  let out = markdown;
  out = stripUnsupportedTags(out);
  out = unwrapMetadataTags(out);
  out = rewritePageLinks(out, titles);
  const { markdown: afterCallouts, report: callouts } = convertCallouts(out);
  out = afterCallouts;
  out = transformInline(out);
  return { markdown: out, report: { callouts } };
}
