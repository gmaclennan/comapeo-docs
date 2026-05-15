// Notion Enhanced Markdown → Docusaurus-friendly Markdown transforms.
// Sprint A: callout conversion only.
// Sprint B will add HTML tag handling, inline transforms, and page-link rewriting.

// Maps the first emoji in a Notion callout to a Docusaurus admonition type.
// Codifies an editorial convention: editors prefix callouts with one of these emojis.
// Anything else (or no emoji) falls back to :::note.
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

function detectType(content: string): string {
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
 * Recurses through nested callouts (innermost first) so admonitions can nest cleanly.
 */
export function convertCallouts(markdown: string): {
  markdown: string;
  report: CalloutReport;
} {
  const report: CalloutReport = { total: 0, byType: {} };

  // Innermost-first replacement. The regex only matches callouts whose body
  // contains no nested <callout>. Each pass converts that frontier; outer
  // callouts become matchable on subsequent passes.
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
      const type = detectType(raw);
      report.total += 1;
      report.byType[type] = (report.byType[type] ?? 0) + 1;
      const body = stripLeadingEmoji(raw).trim();
      return `\n:::${type}\n\n${body}\n\n:::\n`;
    });
  }

  return { markdown: current, report };
}
