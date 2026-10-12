// Pipeline orchestrator.
//
// Each step takes (pages, options) and mutates pages in place. The orchestrator
// reads top to bottom like a recipe; data flow is "the pages map gains more
// fields as we go". Content-quality failures (broken links, missing images,
// truncation) become visible `data-notion-lint` markers IN page.body — the
// markers ARE the report. The orchestrator only tracks counts.

import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { env } from "./env.ts";
import { error, log, warn } from "./logger.ts";
import { walkNotionTree, type Page, type Pages } from "./walk-tree.ts";
import { computePagePaths } from "./paths.ts";
import { transformPageMarkdown } from "./transform.ts";
import { processImagesInMarkdown } from "./images.ts";
import { makeImageStore, type ImageStore } from "./image-store.ts";
import { LINT_ATTRIBUTE } from "./lint-markers.ts";
import { renderPageFile } from "./frontmatter.ts";
import { syncFilesystem } from "./write-files.ts";
import { writeCategoryConfig } from "./category-json.ts";
import { buildManifest, writeManifest } from "./manifest.ts";
import { buildRedirects, writeRedirectsFile } from "./redirects.ts";
import { readHistory, writeHistory } from "./redirect-history.ts";
import { markBrokenLinks } from "./validate.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const MANIFEST_PATH = join(REPO_ROOT, ".canonical-slugs.json");
const STATIC_DIR = join(REPO_ROOT, "static");
const REDIRECTS_PATH = join(STATIC_DIR, "_redirects");
const HISTORY_PATH = join(STATIC_DIR, "redirect-history.json");

export type ExportOptions = {
  rootId: string;
  docsDir: string;
  manifestPath: string;
  redirectsPath: string;
  historyPath: string;
  imageStore: ImageStore;
};

type RenderCounts = {
  rendered: number;
  downloaded: number;
  reused: number;
  bytes: number;
};

// === Step: render markdown + download images for ✅ pages ================

async function renderPages(
  pages: Pages,
  options: ExportOptions,
): Promise<RenderCounts> {
  const titles = new Map<string, string>();
  for (const page of pages.values()) titles.set(page.id, page.title || page.id);

  const counts: RenderCounts = {
    rendered: 0,
    downloaded: 0,
    reused: 0,
    bytes: 0,
  };

  for (const page of pages.values()) {
    if (!page.ready) continue;
    const transformed = transformPageMarkdown(page.markdown, titles);
    const work = await processImagesInMarkdown(transformed, {
      store: options.imageStore,
      page,
    });
    page.body = renderPageFile(
      { title: page.title || "(untitled)" },
      work.markdown,
    );
    counts.rendered += 1;
    counts.downloaded += work.downloaded;
    counts.reused += work.reused;
    counts.bytes += work.bytes;
  }

  return counts;
}

// Truncation is only meaningful when the API didn't also flag unknown
// blocks: unknown_block_ids covers Notion editorial controls (e.g. buttons)
// that we deliberately strip, and their presence is what usually triggers
// the truncated flag. Genuine content loss is `truncated && !unknownBlocks`.
function isGenuinelyTruncated(page: Page): boolean {
  return page.truncated && page.unknownBlockIds.length === 0;
}

function truncatedMarker(pageId: string): string {
  return `\n\n<div ${LINT_ATTRIBUTE}="truncated" data-page="${pageId}">⚠️ Truncated by Notion API — content may be incomplete.</div>\n`;
}

function markTruncated(pages: Pages): number {
  let count = 0;
  for (const page of pages.values()) {
    if (!page.body) continue;
    if (!isGenuinelyTruncated(page)) continue;
    page.body = page.body + truncatedMarker(page.id);
    warn(`truncated by Notion API: "${page.title}" (${page.id})`);
    count += 1;
  }
  return count;
}

// === Orchestrator =======================================================

export async function runExport(options: ExportOptions): Promise<Pages> {
  const tWalk = performance.now();
  const pages = await walkNotionTree({ rootId: options.rootId });
  const ready = [...pages.values()].filter((p) => p.ready).length;
  log(
    `Walked ${pages.size} pages (${ready} ready, ${pages.size - ready} draft) in ${(performance.now() - tWalk).toFixed(0)}ms`,
  );

  computePagePaths(pages);

  const tRender = performance.now();
  const render = await renderPages(pages, options);
  log(
    `Rendered ${render.rendered} pages in ${(performance.now() - tRender).toFixed(0)}ms (images: ${render.downloaded} downloaded, ${render.reused} reused, ${(render.bytes / 1024).toFixed(0)} KB)`,
  );

  const truncated = markTruncated(pages);
  const brokenLinks = markBrokenLinks(pages);

  const fs = await syncFilesystem(pages, { docsDir: options.docsDir });
  const categories = await writeCategoryConfig(pages, {
    docsDir: options.docsDir,
  });

  // Manifest first, then redirects (which read from it).
  const manifest = buildManifest(pages);
  await writeManifest(manifest, { manifestPath: options.manifestPath });
  const priorHistory = await readHistory(options.historyPath);
  const { redirects, history } = buildRedirects(manifest, priorHistory);
  await writeHistory(history, options.historyPath);
  await writeRedirectsFile(redirects, options.redirectsPath);

  log(
    `Files: ${fs.written} written, ${fs.unchanged} unchanged, ${fs.moved} moved, ${fs.deleted} deleted; ${categories} _category_.json, ${redirects.length} redirects, ${brokenLinks} broken links, ${truncated} truncated pages`,
  );

  return pages;
}

// === CLI entry ==========================================================

async function main(): Promise<void> {
  const argId = process.argv[2];
  const rootId = argId ?? env.notionRootPageId;
  if (!rootId) {
    error(
      "no root page id. Pass one as argv[2] or set NOTION_ROOT_PAGE_ID in .env",
    );
    process.exit(1);
  }

  await runExport({
    rootId,
    docsDir: DOCS_DIR,
    manifestPath: MANIFEST_PATH,
    redirectsPath: REDIRECTS_PATH,
    historyPath: HISTORY_PATH,
    imageStore: makeImageStore(),
  });
  log("Done.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
}
