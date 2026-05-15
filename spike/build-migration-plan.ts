/**
 * Builds a migration plan: for each English page worth migrating, fetch its
 * markdown via the Markdown API and emit a JSON file describing the new tree.
 *
 * Output: spike/output/migration-plan.json
 *
 * Tree shape:
 *   {
 *     root: { title, content, icon },
 *     sections: [
 *       {
 *         contentSection,
 *         title,
 *         icon,
 *         content,         // from Title row if present
 *         articles: [
 *           { sourceId, title, icon, content }
 *         ]
 *       }
 *     ]
 *   }
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { fetchPageMarkdown } from "./lib/notion-fetch";

const OUTPUT = join(import.meta.dir ?? __dirname, "output");
const limit = pLimit(3);

type Source = {
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

const READY_STATUSES = new Set(["Draft published", "Ready to publish", "Published"]);

const SECTION_ORDER = [
  "Overview",
  "10-Preparing to use CoMapeo",
  "20-Gathering Observations & Tracks",
  "30-Reviewing Observations & Tracks",
  "40-Managing Data and Privacy",
  "50-Managing Projects",
  "60-Exchanging Observations",
  "70-Sharing and Exporting different data types",
  "80-Ending a project",
  "90+ - Miscellaneous",
];

const SECTION_TITLES: Record<string, string> = {
  Overview: "Overview",
  "10-Preparing to use CoMapeo": "Preparing to Use CoMapeo",
  "20-Gathering Observations & Tracks": "Gathering Observations & Tracks",
  "30-Reviewing Observations & Tracks": "Reviewing Observations & Tracks",
  "40-Managing Data and Privacy": "Managing Data & Privacy",
  "50-Managing Projects": "Managing Projects",
  "60-Exchanging Observations": "Exchanging Observations",
  "70-Sharing and Exporting different data types": "Sharing & Exporting",
  "80-Ending a project": "Ending a Project",
  "90+ - Miscellaneous": "Miscellaneous",
  Misc: "Miscellaneous (uncategorized)",
};

function iconFor(status: string): string {
  return READY_STATUSES.has(status) ? "✅" : "🚧";
}

async function fetchOne(id: string): Promise<{ markdown: string; truncated: boolean }> {
  try {
    const r = await fetchPageMarkdown(id);
    return { markdown: r.markdown, truncated: r.truncated };
  } catch (err: any) {
    console.warn(`  ! fetch failed for ${id}: ${err.message}`);
    return { markdown: `_[Source page ${id} could not be fetched: ${err.message}]_`, truncated: false };
  }
}

async function main() {
  const englishPath = join(OUTPUT, "english-pages.json");
  const data = JSON.parse(readFileSync(englishPath, "utf8")) as Source[];

  const SKIP_TITLES = new Set(["[TEST] Feature Overview"]);
  const filtered = data.filter((p) => !SKIP_TITLES.has(p.title));

  const SKIP_TYPES = new Set(["Toggle"]);
  const usable = filtered.filter((p) => !SKIP_TYPES.has(p.elementType));

  console.log(`Filtered ${data.length} → ${usable.length} pages (dropped tests + Toggle rows)`);

  const groups = new Map<string, Source[]>();
  for (const p of usable) {
    const key = p.contentSection || "Misc";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const orderedSections = [...SECTION_ORDER, "Misc"].filter((s) => groups.has(s));

  console.log(`\nFetching markdown for ${usable.length} source pages (rate-limited 3/s)...\n`);
  const start = performance.now();

  const idToContent = new Map<string, { markdown: string; truncated: boolean }>();
  await Promise.all(
    usable.map((p) =>
      limit(async () => {
        const r = await fetchOne(p.id);
        idToContent.set(p.id, r);
      })
    )
  );
  const fetchMs = performance.now() - start;
  console.log(`Fetched in ${(fetchMs / 1000).toFixed(1)}s\n`);

  const plan: any = {
    generatedAt: new Date().toISOString(),
    root: {
      title: "CoMapeo Docs (page tree)",
      icon: "🚧",
      content:
        "Migrated from the CoMapeo Docs - Gregor Working Copy database on " +
        new Date().toISOString().slice(0, 10) +
        ".\n\nIcon convention: ✅ = ready to publish, 🚧 = draft. Toggle the icon in Notion's sidebar to flip publish state.",
    },
    sections: [] as any[],
    summary: {
      totalSourcePages: data.length,
      migratedPages: 0,
      readyPages: 0,
      draftPages: 0,
      truncatedFetches: 0,
    },
  };

  for (const section of orderedSections) {
    const pages = groups.get(section)!;
    const titleRow = pages.find((p) => p.elementType === "Title");
    const articleRows = pages.filter((p) => p.elementType === "Page" || p.elementType === "");
    articleRows.sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return a.title.localeCompare(b.title);
    });

    const sectionTitle = SECTION_TITLES[section] ?? section;
    const sectionIcon = titleRow ? iconFor(titleRow.status) : "🚧";
    const sectionContent = titleRow
      ? idToContent.get(titleRow.id)?.markdown ?? ""
      : `_${sectionTitle} section landing — content can be added here._`;

    plan.sections.push({
      sourceSection: section,
      sourceTitleRowId: titleRow?.id ?? null,
      title: sectionTitle,
      icon: sectionIcon,
      content: sectionContent,
      articles: articleRows.map((p) => ({
        sourceId: p.id,
        title: p.title,
        icon: iconFor(p.status),
        content: idToContent.get(p.id)?.markdown ?? "",
        truncated: idToContent.get(p.id)?.truncated ?? false,
        sourceStatus: p.status,
        sourceDraftingStatus: p.draftingStatus,
      })),
    });

    plan.summary.migratedPages += articleRows.length + (titleRow ? 1 : 0);
  }

  for (const s of plan.sections) {
    for (const a of s.articles) {
      if (a.icon === "✅") plan.summary.readyPages++;
      else plan.summary.draftPages++;
      if (a.truncated) plan.summary.truncatedFetches++;
    }
  }

  const out = join(OUTPUT, "migration-plan.json");
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(`Wrote ${out}`);

  console.log("\n=== PLAN SUMMARY ===");
  console.log(`Sections: ${plan.sections.length}`);
  console.log(`Articles total: ${plan.summary.migratedPages - plan.sections.filter((s: any) => s.sourceTitleRowId).length}`);
  console.log(`  ready (✅): ${plan.summary.readyPages}`);
  console.log(`  draft (🚧): ${plan.summary.draftPages}`);
  console.log(`Truncated fetches: ${plan.summary.truncatedFetches}`);
  console.log("\nPer-section breakdown:");
  for (const s of plan.sections) {
    console.log(`  ${s.icon} ${s.title}  (${s.articles.length} articles, ${s.content.length} bytes section content)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
