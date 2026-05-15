/**
 * Print MCP create-pages JSON for a single section.
 * Usage: bun spike/print-section-batch.ts "<section title>"
 */
import plan from "./output/migration-plan.sanitized.json" with { type: "json" };
import sectionMap from "./output/section-mapping.json" with { type: "json" };

const sectionTitle = process.argv[2];
if (!sectionTitle) {
  console.error("Usage: bun print-section-batch.ts \"<section title>\"");
  console.error("Available: " + Object.keys(sectionMap.sections).join(", "));
  process.exit(1);
}

const section = (plan as any).sections.find(
  (s: any) => s.title === sectionTitle || s.title === sectionTitle.replace(/\s*\(.*$/, "")
);
if (!section) {
  console.error(`Section not found: ${sectionTitle}`);
  console.error("Available: " + (plan as any).sections.map((s: any) => s.title).join(", "));
  process.exit(1);
}

const parentId = (sectionMap.sections as any)[sectionTitle];
if (!parentId) {
  console.error(`No parent ID mapped for section: ${sectionTitle}`);
  process.exit(1);
}

const pages = section.articles.map((a: any) => ({
  properties: { title: a.title },
  icon: a.icon,
  content: a.content || `_[Empty article migrated from source ${a.sourceId}]_`,
}));

const out = { parent: { type: "page_id", page_id: parentId }, pages };
process.stdout.write(JSON.stringify(out));
