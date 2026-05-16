// Content lint: scan committed docs/ for notion-lint marker attributes
// emitted by the export pipeline. Non-zero exit when any marker is found.
//
// Gated to the staging → published promotion PR via the lint-content GitHub
// Actions workflow. Operates on already-committed markdown — no NOTION_API_KEY,
// no network. The same regex shape works regardless of where the marker
// landed in the file (block div, inline span, inside an admonition, etc.).

import { glob, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { error, log } from "./logger.ts";

export type LintCategory = "broken-link" | "missing-image" | "truncated";

export const LINT_CATEGORIES: readonly LintCategory[] = [
  "broken-link",
  "missing-image",
  "truncated",
] as const;

export type LintFinding = {
  filePath: string;
  category: LintCategory;
  count: number;
};

export type LintReport = {
  findings: LintFinding[];
  total: number;
  byCategory: Record<LintCategory, number>;
};

function countMatches(content: string, category: LintCategory): number {
  const re = new RegExp(`data-notion-lint="${category}"`, "g");
  return (content.match(re) ?? []).length;
}

/**
 * Pure: count `data-notion-lint="..."` occurrences per file per category.
 * Caller provides a map of filePath → content; this avoids any I/O in tests.
 */
export function lintMarkdown(files: Map<string, string>): LintReport {
  const findings: LintFinding[] = [];
  const byCategory: Record<LintCategory, number> = {
    "broken-link": 0,
    "missing-image": 0,
    "truncated": 0,
  };

  const sortedPaths = [...files.keys()].sort();
  for (const filePath of sortedPaths) {
    const content = files.get(filePath)!;
    for (const category of LINT_CATEGORIES) {
      const count = countMatches(content, category);
      if (count === 0) continue;
      findings.push({ filePath, category, count });
      byCategory[category] += count;
    }
  }

  const total =
    byCategory["broken-link"] +
    byCategory["missing-image"] +
    byCategory["truncated"];
  return { findings, total, byCategory };
}

export function formatReport(report: LintReport, docsDir: string): string {
  if (report.total === 0) {
    return "No notion-lint markers found in docs/. OK.";
  }
  const lines: string[] = [
    `Found ${report.total} notion-lint marker(s):`,
    `  broken-link:   ${report.byCategory["broken-link"]}`,
    `  missing-image: ${report.byCategory["missing-image"]}`,
    `  truncated:     ${report.byCategory["truncated"]}`,
    "",
    "Per file:",
  ];
  for (const f of report.findings) {
    const rel = relative(docsDir, f.filePath);
    lines.push(`  ${rel}: ${f.count} × ${f.category}`);
  }
  lines.push("");
  lines.push(
    "These markers indicate content-quality issues that should be fixed",
    "in Notion (or by re-running the export). The staging preview shows",
    "each marker with a dashed red border; production builds strip them.",
  );
  return lines.join("\n");
}

// === CLI entry ==========================================================

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");

async function readAllDocs(docsDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const entry of glob("**/*.{md,mdx}", { cwd: docsDir })) {
    const abs = join(docsDir, entry);
    files.set(abs, await readFile(abs, "utf8"));
  }
  return files;
}

async function main(): Promise<void> {
  const files = await readAllDocs(DOCS_DIR);
  const report = lintMarkdown(files);
  const out = formatReport(report, DOCS_DIR);
  if (report.total > 0) {
    error(out);
    process.exit(1);
  }
  log(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
}
