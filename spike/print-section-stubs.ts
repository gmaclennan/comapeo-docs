/**
 * Print MCP create-pages batch for a section, with PLACEHOLDER content only
 * (preserves structure + title + icon + source ID; real content is backfilled later).
 */
import plan from "./output/migration-plan.sanitized.json" with { type: "json" };
import sectionMap from "./output/section-mapping.json" with { type: "json" };

const sectionKey = process.argv[2];
if (!sectionKey) {
  console.error("Usage: bun print-section-stubs.ts \"<section title>\"");
  console.error("Available: " + Object.keys((sectionMap as any).sections).join(", "));
  process.exit(1);
}

const parentId = (sectionMap as any).sections[sectionKey];
if (!parentId) {
  console.error(`No parent ID for: ${sectionKey}`);
  process.exit(1);
}

let section: any;
if (sectionKey === "Miscellaneous (90+)") {
  section = (plan as any).sections.find((s: any) => s.title === "Miscellaneous");
} else if (sectionKey === "Miscellaneous (uncategorized)") {
  section = (plan as any).sections.find((s: any) => s.title === "Miscellaneous (uncategorized)");
} else {
  section = (plan as any).sections.find((s: any) => s.title === sectionKey);
}
if (!section) {
  console.error(`Section not found: ${sectionKey}`);
  process.exit(1);
}

const pages = section.articles.map((a: any) => ({
  properties: { title: a.title },
  icon: a.icon,
  content: `_Migrated from source page \`${a.sourceId}\` — content backfill pending._\n\nSource Notion URL: https://www.notion.so/${a.sourceId}\n\nSource Publish Status: ${a.sourceStatus || "(none)"}\nSource Drafting Status: ${a.sourceDraftingStatus || "(none)"}\n`,
}));

const out = { parent: { type: "page_id", page_id: parentId }, pages };
process.stdout.write(JSON.stringify(out, null, 2));
