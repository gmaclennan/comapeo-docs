// Pipeline orchestrator.
//
// Each step takes (pages, options) and mutates pages in place. The orchestrator
// reads top to bottom like a recipe; data flow is "the pages map gains more
// fields as we go". No parallel maps or accumulated action lists.

import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { NOTION_ROOT_PAGE_ID } from "./env.ts";
import { error, log } from "./logger.ts";
import { walkNotionTree, type Pages } from "./walk-tree.ts";
import { computePagePaths } from "./paths.ts";
import { transformPageMarkdown } from "./transform.ts";
import {
  makeImageStore,
  processImagesInMarkdown,
  type ImageStore,
} from "./images.ts";
import { renderPageFile } from "./frontmatter.ts";
import { syncFilesystem } from "./write-files.ts";
import { writeCategoryConfig } from "./category-json.ts";
import { writeManifest } from "./manifest.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const MANIFEST_PATH = join(REPO_ROOT, ".canonical-slugs.json");

export type ExportOptions = {
  rootId: string;
  docsDir: string;
  manifestPath: string;
  imageStore: ImageStore;
};

type RenderSummary = {
  rendered: number;
  imagesDownloaded: number;
  imagesReused: number;
  imagesFailed: Array<{ url: string; error: string }>;
  imagesBytes: number;
};

// === Step: render markdown + download images for ✅ pages ================

async function renderPages(
  pages: Pages,
  options: ExportOptions,
): Promise<RenderSummary> {
  const titles = new Map<string, string>();
  for (const page of pages.values()) titles.set(page.id, page.title || page.id);

  const summary: RenderSummary = {
    rendered: 0,
    imagesDownloaded: 0,
    imagesReused: 0,
    imagesFailed: [],
    imagesBytes: 0,
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
    summary.rendered += 1;
    summary.imagesDownloaded += work.downloaded;
    summary.imagesReused += work.reused;
    summary.imagesFailed.push(...work.failed);
    summary.imagesBytes += work.bytes;
  }

  return summary;
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
    `Rendered ${render.rendered} pages in ${(performance.now() - tRender).toFixed(0)}ms (images: ${render.imagesDownloaded} downloaded, ${render.imagesReused} reused, ${render.imagesFailed.length} failed, ${(render.imagesBytes / 1024).toFixed(0)} KB)`,
  );
  for (const f of render.imagesFailed) {
    error(`image fetch failed: ${f.url} (${f.error})`);
  }

  const fs = await syncFilesystem(pages, { docsDir: options.docsDir });
  const categories = await writeCategoryConfig(pages, {
    docsDir: options.docsDir,
  });
  await writeManifest(pages, { manifestPath: options.manifestPath });
  log(
    `Files: ${fs.written} written, ${fs.unchanged} unchanged, ${fs.moved} moved, ${fs.deleted} deleted; wrote ${categories} _category_.json + manifest`,
  );

  return pages;
}

// === CLI entry ==========================================================

async function main(): Promise<void> {
  const argId = process.argv[2];
  const rootId = argId ?? NOTION_ROOT_PAGE_ID;
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
