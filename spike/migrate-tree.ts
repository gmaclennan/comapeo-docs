/**
 * Migrate the English page set into a real page tree using direct Notion API
 * calls (so the local integration owns the new pages and the publish pipeline
 * can read them).
 *
 * - Creates root page at workspace level (no parent — workspace-level private page)
 * - Creates 10 section pages under root
 * - Creates 49 article pages, batched per section
 * - Captures all sourceId → newId mappings into output/migration-mapping.json
 *
 * Run after sanitize-plan.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { createPageMarkdown } from "./lib/notion-write";

const OUTPUT = join(import.meta.dir ?? __dirname, "output");
const limit = pLimit(2);

type Plan = {
  root: { title: string; icon: string; content: string };
  sections: Array<{
    sourceSection: string;
    sourceTitleRowId: string | null;
    title: string;
    icon: string;
    content: string;
    articles: Array<{
      sourceId: string;
      title: string;
      icon: string;
      content: string;
    }>;
  }>;
};

async function main() {
  const plan = JSON.parse(readFileSync(join(OUTPUT, "migration-plan.sanitized.json"), "utf8")) as Plan;
  const mapping: any = {
    rootId: null,
    rootUrl: null,
    sections: [],
    articleByOldId: {},
    failures: [],
  };

  console.log(`Creating root...`);
  const root = await createPageMarkdown({
    parent: { type: "workspace", workspace: true },
    title: plan.root.title,
    icon: plan.root.icon,
    markdown: plan.root.content,
  });
  mapping.rootId = root.id.replace(/-/g, "");
  mapping.rootUrl = root.url;
  console.log(`  → ${mapping.rootId}`);

  for (const section of plan.sections) {
    console.log(`\nSection: ${section.title}`);
    const sec = await createPageMarkdown({
      parent: { type: "page_id", page_id: mapping.rootId },
      title: section.title,
      icon: section.icon,
      markdown: section.content || `_${section.title} section landing._`,
    });
    const sectionId = sec.id.replace(/-/g, "");
    console.log(`  section page → ${sectionId}`);

    const sectionRecord: any = {
      sourceSection: section.sourceSection,
      sourceTitleRowId: section.sourceTitleRowId,
      sectionId,
      sectionUrl: sec.url,
      articles: [],
    };

    if (section.sourceTitleRowId) {
      mapping.articleByOldId[section.sourceTitleRowId] = sectionId;
    }

    const results = await Promise.allSettled(
      section.articles.map((a) =>
        limit(async () => {
          const page = await createPageMarkdown({
            parent: { type: "page_id", page_id: sectionId },
            title: a.title,
            icon: a.icon,
            markdown: a.content || `_[Empty source page ${a.sourceId}]_`,
          });
          const newId = page.id.replace(/-/g, "");
          mapping.articleByOldId[a.sourceId] = newId;
          sectionRecord.articles.push({
            sourceId: a.sourceId,
            title: a.title,
            icon: a.icon,
            newId,
            url: page.url,
          });
          console.log(`  + ${a.icon} ${a.title} → ${newId}`);
          return { sourceId: a.sourceId, newId };
        })
      )
    );

    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        const a = section.articles[i];
        mapping.failures.push({
          section: section.title,
          sourceId: a.sourceId,
          title: a.title,
          icon: a.icon,
          error: String(r.reason).slice(0, 1500),
        });
        console.log(`  ! FAILED ${a.title}: ${String(r.reason).slice(0, 200)}`);
      }
    }

    mapping.sections.push(sectionRecord);

    writeFileSync(join(OUTPUT, "migration-mapping.json"), JSON.stringify(mapping, null, 2));
  }

  writeFileSync(join(OUTPUT, "migration-mapping.json"), JSON.stringify(mapping, null, 2));

  console.log(`\n=== DONE ===`);
  console.log(`Root: ${mapping.rootUrl}`);
  console.log(`Sections: ${mapping.sections.length}`);
  console.log(`Articles created: ${Object.keys(mapping.articleByOldId).length - mapping.sections.filter((s: any) => s.sourceTitleRowId).length}`);
  console.log(`Failures: ${mapping.failures.length}`);
  if (mapping.failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of mapping.failures) console.log(`  ${f.section} / ${f.title}: ${f.error.slice(0, 200)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
