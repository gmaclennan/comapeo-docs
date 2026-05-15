/**
 * Recompute icons from Drafting Status (instead of Publish Status) and emit
 * the diff: which article pages need their icon flipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT = join(import.meta.dir ?? __dirname, "output");

// "Ready" Drafting Status values — these become ✅; all others become 🚧
const READY_DRAFTING = new Set([
  "EN Done",
  "Translations Validated",
  "Pre-publish done",
]);

function iconFromDrafting(draftingStatus: string): string {
  return READY_DRAFTING.has(draftingStatus) ? "✅" : "🚧";
}

const englishPages = JSON.parse(readFileSync(join(OUTPUT, "english-pages.json"), "utf8")) as any[];
const treeMapping = JSON.parse(readFileSync(join(OUTPUT, "tree-mapping.json"), "utf8"));

const sourceById = new Map(englishPages.map((p) => [p.id, p]));

const changes: Array<{
  newId: string;
  title: string;
  section: string;
  sourceId: string;
  draftingStatus: string;
  oldIcon: string;
  newIcon: string;
}> = [];

const noChange: Array<any> = [];

for (const section of treeMapping.sections) {
  for (const article of section.articles) {
    const source = sourceById.get(article.sourceId);
    if (!source) {
      console.error(`! source not found for ${article.title} (sourceId=${article.sourceId})`);
      continue;
    }
    const newIcon = iconFromDrafting(source.draftingStatus);
    const publishStatusReadyStatuses = new Set(["Draft published", "Ready to publish", "Published"]);
    const oldIcon = publishStatusReadyStatuses.has(source.status) ? "✅" : "🚧";

    if (newIcon !== oldIcon) {
      changes.push({
        newId: article.newId,
        title: article.title,
        section: section.title,
        sourceId: article.sourceId,
        draftingStatus: source.draftingStatus || "(none)",
        oldIcon,
        newIcon,
      });
    } else {
      noChange.push({ title: article.title, oldIcon });
    }
  }
}

writeFileSync(join(OUTPUT, "icon-diff.json"), JSON.stringify(changes, null, 2));

console.log(`\n=== Icon updates needed: ${changes.length} of ${changes.length + noChange.length} articles ===\n`);
const promotions = changes.filter((c) => c.newIcon === "✅");
const demotions = changes.filter((c) => c.newIcon === "🚧");

console.log(`Promote 🚧 → ✅: ${promotions.length}`);
for (const c of promotions) console.log(`  ${c.section} / ${c.title}  [drafting=${c.draftingStatus}]  newId=${c.newId}`);

console.log(`\nDemote ✅ → 🚧: ${demotions.length}`);
for (const c of demotions) console.log(`  ${c.section} / ${c.title}  [drafting=${c.draftingStatus}]  newId=${c.newId}`);

console.log(`\nUnchanged: ${noChange.length}`);
console.log(`\nWrote diff to ${join(OUTPUT, "icon-diff.json")}`);
