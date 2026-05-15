// Pure parsing helpers for Notion-emitted Markdown.
// No env, no I/O — safe to import in tests without setup.

const PAGE_TAG_RE =
  /<page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"(?:\s+color="[^"]*")?>[\s\S]*?<\/page>/g;
const SELF_CLOSING_PAGE_RE =
  /<page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"\s*\/>/g;
const MENTION_PAGE_RE =
  /<mention-page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"\s*\/>/g;

/**
 * Extract child page IDs (32-char hex, no dashes) from a Notion markdown string,
 * preserving document order and de-duplicating repeats.
 *
 * Matches both `<page url="..." color="...">title</page>` and self-closing
 * `<page url="..."/>` forms. Ignores `<mention-page/>` which represents
 * cross-references, not parent-child structure.
 */
export function extractChildIds(markdown: string): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const combined = new RegExp(
    `${PAGE_TAG_RE.source}|${SELF_CLOSING_PAGE_RE.source}`,
    "g",
  );

  for (const match of markdown.matchAll(combined)) {
    const id = match[1] ?? match[2];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

/**
 * Extract `<mention-page url=".../>` page IDs (cross-references) from
 * a Notion markdown string. De-duplicated; order preserved.
 */
export function extractMentionIds(markdown: string): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(MENTION_PAGE_RE)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}
