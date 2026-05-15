// Minimal frontmatter emission per tree-publish-plan §5.
//
// We emit ONLY `title:` (and optionally `description:`). Everything else
// — `id`, `slug`, `sidebar_position`, `last_update`, `custom_edit_url` —
// is derived at build time (canonical-slug plugin, Sprint C) or set globally
// in docusaurus.config.ts.

function escapeYamlString(value: string): string {
  if (value === "") return '""';
  // Always double-quote to keep the output deterministic and safe for any
  // title content (emojis, colons, brackets, leading dashes, etc.).
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export type Frontmatter = {
  title: string;
  description?: string;
};

export function renderFrontmatter(fm: Frontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${escapeYamlString(fm.title)}`);
  if (fm.description !== undefined) {
    lines.push(`description: ${escapeYamlString(fm.description)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Emit a fully-formed `.md` file body: frontmatter + blank line + content.
 * The content should already have been transformed by transformPageMarkdown().
 */
export function renderPageFile(fm: Frontmatter, content: string): string {
  const head = renderFrontmatter(fm);
  const body = content.replace(/^\s+/, "");
  return `${head}${body}\n`;
}
