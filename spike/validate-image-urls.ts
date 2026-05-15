/**
 * Validation: fetch every page in the working-copy DB and categorize image URLs.
 *
 * Outputs a breakdown of:
 *   - notion-hosted (prod-files-secure.s3.us-west-2.amazonaws.com)  → R2 upload required
 *   - external (other http/https)                                    → pass through
 *   - file://                                                        → page attachment, NOT resolvable via this API
 *   - other (data:, blob:, relative, etc.)
 *
 * This informs whether we need to invest engineering in handling file:// images
 * or whether we can lean on editors to convert them to proper Notion uploads.
 *
 * Run:  bun spike/validate-image-urls.ts
 */
import {
  fetchPageMarkdown,
  queryDataSource,
  type NotionPage,
} from "./lib/notion-fetch";
import { DATA_SOURCE_ID, DATABASE_ID } from "./lib/env";

// Image-extracting regex: matches markdown image, <img>, <video src>, <audio src>, <file src>, <pdf src>
const IMAGE_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: "md-image", re: /!\[[^\]]*\]\(([^)\s]+)\)/g },
  { kind: "video", re: /<video\s+[^>]*src="([^"]+)"/g },
  { kind: "audio", re: /<audio\s+[^>]*src="([^"]+)"/g },
  { kind: "file", re: /<file\s+[^>]*src="([^"]+)"/g },
  { kind: "pdf", re: /<pdf\s+[^>]*src="([^"]+)"/g },
];

type UrlCategory = "notion-hosted" | "external" | "file" | "other";

function categorize(url: string): UrlCategory {
  if (url.startsWith("file://")) return "file";
  if (
    url.includes("prod-files-secure.s3.us-west-2.amazonaws.com") ||
    url.includes("secure.notion-static.com") ||
    url.includes("file.notion.so")
  )
    return "notion-hosted";
  if (url.startsWith("http://") || url.startsWith("https://"))
    return "external";
  return "other";
}

function extractAllUrls(markdown: string): Array<{ kind: string; url: string }> {
  const urls: Array<{ kind: string; url: string }> = [];
  for (const { kind, re } of IMAGE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
      urls.push({ kind, url: m[1] });
    }
  }
  return urls;
}

function getPlainText(prop: any): string {
  if (!prop) return "";
  const arr = prop.title ?? prop.rich_text ?? [];
  return arr.map((t: any) => t.plain_text ?? "").join("");
}

async function main() {
  if (!DATA_SOURCE_ID && !DATABASE_ID) {
    console.error("Set DATA_SOURCE_ID or DATABASE_ID in .env");
    process.exit(1);
  }

  // 1) List all pages
  console.log("Listing all pages in data source...");
  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  do {
    const body: Record<string, any> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = DATA_SOURCE_ID
      ? await queryDataSource(DATA_SOURCE_ID, body)
      : await import("./lib/notion-fetch").then((m) =>
          m.queryDatabase(DATABASE_ID!, body)
        );
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  console.log(`Found ${pages.length} pages.\n`);

  // 2) Fetch each page sequentially with a small inter-call sleep (~3 rps friendly)
  const aggregate: Record<UrlCategory, number> = {
    "notion-hosted": 0,
    external: 0,
    file: 0,
    other: 0,
  };
  const perKind: Record<string, Record<UrlCategory, number>> = {};
  const fileUrlPages: Array<{ title: string; count: number; url: string }> = [];
  let totalImageCount = 0;
  let pagesWithFileUrls = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const title = getPlainText(page.properties?.["Content elements"]).slice(0, 60) ||
      "(no title)";
    process.stdout.write(
      `[${(i + 1).toString().padStart(3)}/${pages.length}] ${title.padEnd(62)} `
    );
    try {
      // Sleep ~350ms between calls to stay well under 3 rps
      if (i > 0) await new Promise((r) => setTimeout(r, 350));
      const res = await fetchPageMarkdown(page.id);
      const urls = extractAllUrls(res.markdown);
      let pageFileCount = 0;
      const pageCounts: Record<UrlCategory, number> = {
        "notion-hosted": 0,
        external: 0,
        file: 0,
        other: 0,
      };
      for (const { kind, url } of urls) {
        const cat = categorize(url);
        aggregate[cat] += 1;
        pageCounts[cat] += 1;
        perKind[kind] = perKind[kind] || {
          "notion-hosted": 0,
          external: 0,
          file: 0,
          other: 0,
        };
        perKind[kind][cat] += 1;
        totalImageCount += 1;
        if (cat === "file") pageFileCount += 1;
      }
      if (pageFileCount > 0) {
        pagesWithFileUrls += 1;
        fileUrlPages.push({
          title,
          count: pageFileCount,
          url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`,
        });
      }
      console.log(
        `n=${pageCounts["notion-hosted"]} ext=${pageCounts.external} file=${pageCounts.file} other=${pageCounts.other}${res.truncated ? " [truncated]" : ""}`
      );
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      errors.push({
        id: page.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3) Report
  console.log("\n=== SUMMARY ===\n");
  console.log(`Pages fetched: ${pages.length - errors.length} / ${pages.length}`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
  }
  console.log(`Total image/media references: ${totalImageCount}`);
  console.log("");
  console.log("By category:");
  for (const cat of ["notion-hosted", "external", "file", "other"] as const) {
    const pct = totalImageCount
      ? ((aggregate[cat] / totalImageCount) * 100).toFixed(1)
      : "0.0";
    console.log(`  ${cat.padEnd(14)} ${aggregate[cat].toString().padStart(5)} (${pct}%)`);
  }
  console.log("");
  console.log("By media kind:");
  for (const [kind, counts] of Object.entries(perKind)) {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    console.log(`  ${kind.padEnd(10)} total=${total}  notion=${counts["notion-hosted"]} ext=${counts.external} file=${counts.file} other=${counts.other}`);
  }
  console.log("");
  console.log(`Pages with at least one file:// URL: ${pagesWithFileUrls} / ${pages.length} (${((pagesWithFileUrls / pages.length) * 100).toFixed(1)}%)`);
  if (fileUrlPages.length > 0) {
    console.log("\nPages with file:// images (showing top 30):");
    fileUrlPages
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .forEach((p) => {
        console.log(`  ${p.count.toString().padStart(3)}  ${p.title}  ${p.url}`);
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
