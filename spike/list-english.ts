/**
 * List all English pages from the source data source with the metadata
 * needed to design the new page tree migration.
 *
 * Output: JSON file at spike/output/english-pages.json with one entry per page,
 * sorted by Order. Also prints a human-readable summary.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_SOURCE_ID, DATABASE_ID } from "./lib/env";
import { queryDataSource, queryDatabase, type NotionPage } from "./lib/notion-fetch";

const OUTPUT_DIR = join(import.meta.dir ?? __dirname, "output");

function getPlainText(prop: any): string {
  if (!prop) return "";
  const arr = prop.title ?? prop.rich_text ?? [];
  return arr.map((t: any) => t.plain_text ?? "").join("");
}

function getSelect(prop: any): string {
  return prop?.select?.name ?? "";
}

function getNumber(prop: any): number | null {
  return typeof prop?.number === "number" ? prop.number : null;
}

function getRelation(prop: any): string[] {
  if (!prop?.relation) return [];
  return prop.relation.map((r: any) => r.id);
}

type EnglishPage = {
  id: string;
  title: string;
  status: string;
  draftingStatus: string;
  elementType: string;
  contentSection: string;
  order: number | null;
  parentItem: string[];
  subItems: string[];
  lastEdited: string;
  url: string;
};

async function main() {
  const fetcher = DATA_SOURCE_ID
    ? (body: Record<string, any>) => queryDataSource(DATA_SOURCE_ID!, body)
    : DATABASE_ID
      ? (body: Record<string, any>) => queryDatabase(DATABASE_ID!, body)
      : null;

  if (!fetcher) {
    console.error("Set DATA_SOURCE_ID (preferred) or DATABASE_ID in .env");
    process.exit(1);
  }

  const filter = {
    and: [
      { property: "Language", select: { equals: "English" } },
      { property: "Publish Status", select: { does_not_equal: "Remove" } },
      { property: "Publish Status", select: { does_not_equal: "Unplublished" } },
    ],
  };

  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const body: Record<string, any> = { page_size: 100, filter };
    if (cursor) body.start_cursor = cursor;
    const res = await fetcher(body);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  const english: EnglishPage[] = pages.map((p) => ({
    id: p.id.replace(/-/g, ""),
    title: getPlainText(p.properties["Content elements"]),
    status: getSelect(p.properties["Publish Status"]),
    draftingStatus: getSelect(p.properties["Drafting Status "]),
    elementType: getSelect(p.properties["Element Type"]),
    contentSection: getSelect(p.properties["Content Section"]),
    order: getNumber(p.properties["Order"]),
    parentItem: getRelation(p.properties["Parent item"]).map((id) => id.replace(/-/g, "")),
    subItems: getRelation(p.properties["Sub-item"]).map((id) => id.replace(/-/g, "")),
    lastEdited: p.last_edited_time,
    url: p.url,
  }));

  english.sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return a.title.localeCompare(b.title);
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = join(OUTPUT_DIR, "english-pages.json");
  writeFileSync(outFile, JSON.stringify(english, null, 2));

  console.log(`\nWrote ${english.length} English pages to ${outFile}\n`);

  console.log("=== SUMMARY BY ELEMENT TYPE ===");
  const byType = new Map<string, number>();
  for (const p of english) byType.set(p.elementType || "(none)", (byType.get(p.elementType || "(none)") ?? 0) + 1);
  for (const [type, n] of [...byType.entries()].sort()) console.log(`  ${type}: ${n}`);

  console.log("\n=== SUMMARY BY PUBLISH STATUS ===");
  const byStatus = new Map<string, number>();
  for (const p of english) byStatus.set(p.status || "(none)", (byStatus.get(p.status || "(none)") ?? 0) + 1);
  for (const [s, n] of [...byStatus.entries()].sort()) console.log(`  ${s}: ${n}`);

  console.log("\n=== SUMMARY BY CONTENT SECTION ===");
  const bySection = new Map<string, number>();
  for (const p of english) bySection.set(p.contentSection || "(none)", (bySection.get(p.contentSection || "(none)") ?? 0) + 1);
  for (const [s, n] of [...bySection.entries()].sort()) console.log(`  ${s}: ${n}`);

  console.log("\n=== TREE VIEW (parent/child via Parent item relation) ===");
  const byId = new Map(english.map((p) => [p.id, p]));
  const roots = english.filter((p) => p.parentItem.length === 0);
  const printNode = (p: EnglishPage, depth: number) => {
    const flag = ["Ready to publish", "Published", "Draft published"].includes(p.status) ? "✅" : "🚧";
    const orderStr = p.order != null ? `[${p.order}]` : "[?]";
    console.log(`${"  ".repeat(depth)}${flag} ${orderStr} ${p.elementType.padEnd(7)} ${p.title}  (${p.id})`);
    for (const childId of p.subItems) {
      const child = byId.get(childId);
      if (child) printNode(child, depth + 1);
    }
  };
  for (const r of roots) printNode(r, 0);

  const orphans = english.filter((p) => p.parentItem.length > 0 && !byId.has(p.parentItem[0]));
  if (orphans.length > 0) {
    console.log("\n=== ORPHANS (parent not in English set) ===");
    for (const o of orphans) console.log(`  ${o.title}  parent=${o.parentItem[0]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
