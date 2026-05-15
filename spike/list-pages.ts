/**
 * List pages in the configured Notion data source so you can pick 5 representative
 * page IDs for the spike.
 *
 * Prints: id  |  language  |  status  |  title
 *
 * Pick 5 with diverse content shapes (callouts, images, toggles, tables, sub-pages)
 * and put their IDs in spike/page-ids.txt (one per line), then run:
 *   bun spike/run-spike.ts
 */
import { DATA_SOURCE_ID, DATABASE_ID } from "./lib/env";
import { queryDataSource, queryDatabase, type NotionPage } from "./lib/notion-fetch";

function getPlainText(prop: any): string {
  if (!prop) return "";
  const arr = prop.title ?? prop.rich_text ?? [];
  return arr.map((t: any) => t.plain_text ?? "").join("");
}

function getSelect(prop: any): string {
  return prop?.select?.name ?? "";
}

async function main() {
  const fetcher = DATA_SOURCE_ID
    ? () => queryDataSource(DATA_SOURCE_ID!, { page_size: 100 })
    : DATABASE_ID
      ? () => queryDatabase(DATABASE_ID!, { page_size: 100 })
      : null;

  if (!fetcher) {
    console.error("Set DATA_SOURCE_ID (preferred) or DATABASE_ID in .env");
    process.exit(1);
  }

  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const body: Record<string, any> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = DATA_SOURCE_ID
      ? await queryDataSource(DATA_SOURCE_ID, body)
      : await queryDatabase(DATABASE_ID!, body);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);

  console.log(`\nFound ${pages.length} pages.\n`);
  console.log("ID                                    LANG  STATUS               TITLE");
  console.log("-".repeat(120));

  for (const page of pages) {
    const title = getPlainText(page.properties["Content elements"]);
    const lang = getSelect(page.properties["Language"]).slice(0, 4);
    const status = getSelect(page.properties["Publish Status"]).slice(0, 20);
    console.log(
      `${page.id}  ${lang.padEnd(4)}  ${status.padEnd(20)}  ${title}`
    );
  }

  console.log(
    `\nNext: pick 5 page IDs (ideally English, with varied content shapes) and put them in spike/page-ids.txt, one per line.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
