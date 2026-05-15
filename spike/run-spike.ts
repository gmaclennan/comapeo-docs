/**
 * Runs the Markdown Content API spike against the page IDs in spike/page-ids.txt
 * (or passed as CLI args). For each page it writes:
 *
 *   spike/output/<n>-<id>/raw.json        full API response
 *   spike/output/<n>-<id>/raw.md          raw markdown from the API
 *   spike/output/<n>-<id>/with-images.md  after image download + URL rewrite
 *   spike/output/<n>-<id>/processed.md    after callout conversion
 *   spike/output/<n>-<id>/images/         downloaded images
 *
 * Concurrency: p-limit(3) approximates Notion's 3 req/s cap (good enough for 5 pages).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "p-limit";
import { fetchPageMarkdown } from "./lib/notion-fetch";
import { downloadImages } from "./lib/download-images";
import { convertCallouts } from "./lib/convert-callouts";

const OUTPUT_ROOT = join(import.meta.dir ?? __dirname, "output");
const limit = pLimit(3);

async function loadPageIds(): Promise<string[]> {
  const fromArgs = process.argv.slice(2).filter(Boolean);
  if (fromArgs.length > 0) return fromArgs;

  try {
    const content = await readFile(
      join(import.meta.dir ?? __dirname, "page-ids.txt"),
      "utf8"
    );
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    console.error(
      "No page IDs provided. Either pass IDs as CLI args, or write them to spike/page-ids.txt (one per line)."
    );
    process.exit(1);
  }
}

function countTags(markdown: string, tag: string): number {
  return (markdown.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;
}

async function processPage(pageId: string, index: number) {
  const dir = join(OUTPUT_ROOT, `${String(index + 1).padStart(2, "0")}-${pageId}`);
  await mkdir(dir, { recursive: true });

  const fetchStart = performance.now();
  const response = await fetchPageMarkdown(pageId);
  const fetchMs = performance.now() - fetchStart;

  await writeFile(join(dir, "raw.json"), JSON.stringify(response, null, 2));
  await writeFile(join(dir, "raw.md"), response.markdown);

  const imagesDir = join(dir, "images");
  const { markdown: withImages, report: imageReport } = await downloadImages(
    response.markdown,
    imagesDir,
    "./images"
  );
  await writeFile(join(dir, "with-images.md"), withImages);

  const { markdown: processed, report: calloutReport } =
    convertCallouts(withImages);
  await writeFile(join(dir, "processed.md"), processed);

  return {
    pageId,
    fetchMs,
    bytes: response.markdown.length,
    truncated: response.truncated,
    unknownBlocks: response.unknown_block_ids.length,
    images: imageReport,
    callouts: calloutReport,
    blockTagCounts: {
      callout: countTags(response.markdown, "callout"),
      details: countTags(response.markdown, "details"),
      table: countTags(response.markdown, "table"),
      columns: countTags(response.markdown, "columns"),
      page: countTags(response.markdown, "page"),
      database: countTags(response.markdown, "database"),
      unknown: countTags(response.markdown, "unknown"),
      video: countTags(response.markdown, "video"),
      file: countTags(response.markdown, "file"),
    },
  };
}

async function main() {
  const pageIds = await loadPageIds();
  console.log(`\nProcessing ${pageIds.length} page(s)...\n`);

  const totalStart = performance.now();
  const results = await Promise.all(
    pageIds.map((id, i) => limit(() => processPage(id, i)))
  );
  const totalMs = performance.now() - totalStart;

  console.log("\n=== RESULTS ===\n");
  for (const r of results) {
    console.log(`Page ${r.pageId}`);
    console.log(`  fetch: ${r.fetchMs.toFixed(0)}ms, ${r.bytes} bytes`);
    console.log(
      `  truncated: ${r.truncated}, unknown blocks: ${r.unknownBlocks}`
    );
    console.log(
      `  images: ${r.images.downloaded}/${r.images.total} downloaded, ${r.images.failed.length} failed, ${(r.images.bytes / 1024).toFixed(0)} KB`
    );
    if (r.images.failed.length > 0) {
      console.log(
        `    failures: ${r.images.failed.map((f) => f.error).join(", ")}`
      );
    }
    console.log(
      `  callouts: ${r.callouts.total} (${Object.entries(r.callouts.byType)
        .map(([t, n]) => `${t}=${n}`)
        .join(", ") || "none"})`
    );
    const interesting = Object.entries(r.blockTagCounts).filter(
      ([, n]) => n > 0
    );
    if (interesting.length > 0) {
      console.log(
        `  blocks: ${interesting.map(([t, n]) => `${t}=${n}`).join(", ")}`
      );
    }
    console.log("");
  }

  console.log(`Total: ${(totalMs / 1000).toFixed(1)}s for ${pageIds.length} pages`);
  console.log(`Inspect output in spike/output/\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
