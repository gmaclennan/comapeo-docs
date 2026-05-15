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

const CALLOUT_RE = /<callout>([\s\S]*?)<\/callout>/g;

function detectType(content: string): string {
  const trimmed = content.trimStart();
  for (const [re, type] of EMOJI_TO_TYPE) {
    if (re.test(trimmed)) return type;
  }
  return "note";
}

function stripLeadingEmoji(content: string): string {
  const leading = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}️]+\s*/u;
  return content.replace(leading, "");
}

export type CalloutReport = {
  total: number;
  byType: Record<string, number>;
};

export function convertCallouts(
  markdown: string
): { markdown: string; report: CalloutReport } {
  const report: CalloutReport = { total: 0, byType: {} };

  const out = markdown.replace(CALLOUT_RE, (_whole, raw: string) => {
    const type = detectType(raw);
    report.total += 1;
    report.byType[type] = (report.byType[type] ?? 0) + 1;

    const body = stripLeadingEmoji(raw).trim();
    return `\n:::${type}\n\n${body}\n\n:::\n`;
  });

  return { markdown: out, report };
}
