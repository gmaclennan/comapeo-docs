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
import {
  LINT_ATTRIBUTE,
  LINT_MARKER_CATEGORIES,
  type LintMarkerCategory,
} from "./lint-markers.ts";
import { error, log } from "./logger.ts";

// Quote-and-whitespace tolerant. Captures the category value so detection
// doesn't care about attribute ordering, but only counts categories listed
// in `LINT_MARKER_CATEGORIES` — drift in either emission or detection is
// caught by `lint.test.ts`'s round-trip contract test.
const MARKER_RE = new RegExp(
  `\\b${LINT_ATTRIBUTE}\\s*=\\s*"([^"]+)"`,
  "g",
);

export type LintCategory = LintMarkerCategory;
export const LINT_CATEGORIES = LINT_MARKER_CATEGORIES;

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

function countByCategory(content: string): Map<LintCategory, number> {
  const counts = new Map<LintCategory, number>();
  for (const match of content.matchAll(MARKER_RE)) {
    const value = match[1];
    if (!(LINT_MARKER_CATEGORIES as readonly string[]).includes(value)) continue;
    const cat = value as LintCategory;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return counts;
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
    "custom-emoji": 0,
  };

  const sortedPaths = [...files.keys()].sort();
  for (const filePath of sortedPaths) {
    const counts = countByCategory(files.get(filePath)!);
    for (const category of LINT_CATEGORIES) {
      const count = counts.get(category) ?? 0;
      if (count === 0) continue;
      findings.push({ filePath, category, count });
      byCategory[category] += count;
    }
  }

  const total = LINT_CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0);
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
    `  custom-emoji:  ${report.byCategory["custom-emoji"]}`,
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
  // Report goes to stdout in both success and failure cases so PR check
  // viewers see it in the primary log stream; stderr stays reserved for
  // operational errors (read failures, etc.). Exit code conveys pass/fail.
  log(formatReport(report, DOCS_DIR));
  if (report.total > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
}
