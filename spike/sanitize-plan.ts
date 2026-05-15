/**
 * Sanitize the migration-plan.json for input to POST /v1/pages.
 *
 * Strips output-only / unsupported markup and writes migration-plan.sanitized.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT = join(import.meta.dir ?? __dirname, "output");

function sanitize(md: string): { out: string; report: Record<string, number> } {
  const report: Record<string, number> = {
    unknownStripped: 0,
    tocStripped: 0,
    syncedBlockUnwrapped: 0,
    fileUrlImagesStripped: 0,
    discussionStripped: 0,
  };

  let out = md;

  // Strip <unknown ... /> (self-closing or tag pair)
  out = out.replace(/<unknown\b[^>]*\/>/g, () => {
    report.unknownStripped++;
    return "";
  });
  out = out.replace(/<unknown\b[^>]*>[\s\S]*?<\/unknown>/g, () => {
    report.unknownStripped++;
    return "";
  });

  // Strip <table_of_contents .../>
  out = out.replace(/<table_of_contents\b[^>]*\/>/g, () => {
    report.tocStripped++;
    return "";
  });

  // Unwrap <synced_block url="..."> CONTENT </synced_block>
  out = out.replace(
    /<synced_block(?:_reference)?\b[^>]*>([\s\S]*?)<\/synced_block(?:_reference)?>/g,
    (_, inner) => {
      report.syncedBlockUnwrapped++;
      return inner.trim();
    }
  );

  // Strip images whose URL is file:// (Notion attachment, not resolvable)
  out = out.replace(/!\[[^\]]*\]\(file:\/\/[^)]*\)/g, () => {
    report.fileUrlImagesStripped++;
    return "_[image not migrated — please re-upload in Notion]_";
  });

  // Unwrap <span discussion-urls="...">text</span>
  out = out.replace(/<span\s+discussion-urls="[^"]*"[^>]*>([\s\S]*?)<\/span>/g, (_, inner) => {
    report.discussionStripped++;
    return inner;
  });

  // Collapse blank line runs
  out = out.replace(/\n{4,}/g, "\n\n\n");

  return { out: out.trim(), report };
}

function main() {
  const planPath = join(OUTPUT, "migration-plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));

  const totalReport: Record<string, number> = {};
  let pagesProcessed = 0;

  const processOne = (text: string) => {
    const { out, report } = sanitize(text);
    for (const [k, v] of Object.entries(report)) totalReport[k] = (totalReport[k] ?? 0) + v;
    pagesProcessed++;
    return out;
  };

  plan.root.content = processOne(plan.root.content);

  for (const s of plan.sections) {
    s.content = processOne(s.content);
    for (const a of s.articles) {
      a.content = processOne(a.content);
    }
  }

  const outPath = join(OUTPUT, "migration-plan.sanitized.json");
  writeFileSync(outPath, JSON.stringify(plan, null, 2));

  console.log(`Sanitized ${pagesProcessed} pages → ${outPath}`);
  console.log("Removals:");
  for (const [k, v] of Object.entries(totalReport)) console.log(`  ${k}: ${v}`);

  let totalSize = 0;
  let pageCount = 0;
  for (const s of plan.sections) {
    totalSize += s.content.length;
    pageCount++;
    for (const a of s.articles) {
      totalSize += a.content.length;
      pageCount++;
    }
  }
  console.log(`Total content size after sanitization: ${(totalSize / 1024).toFixed(0)} KB across ${pageCount} pages`);
}

main();
