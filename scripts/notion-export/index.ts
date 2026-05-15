// Pipeline orchestrator.
// Sprint B: walk → transform → images → write/move/delete → _category_.json.
// Sprint C will add the canonical-slug Docusaurus plugin (separate concern).
// Sprint D will add redirects + validation + CI.

import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { NOTION_ROOT_PAGE_ID } from "./env.ts";
import { error, log } from "./logger.ts";
import { walkTree, flattenTree, type TreeNode } from "./walk-tree.ts";
import { transformPageMarkdown } from "./transform.ts";
import {
  processImagesInMarkdown,
  makeImageStore,
  makeEmptyReport,
  type ImageReport,
  type ImageStore,
} from "./images.ts";
import { renderPageFile } from "./frontmatter.ts";
import { buildPaths } from "./paths.ts";
import {
  applyActions,
  globExistingFiles,
  planActions,
} from "./write-files.ts";
import { writeCategoryJsonFiles } from "./category-json.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const DOCS_ROOT = join(REPO_ROOT, "docs");

function buildTitleMap(root: TreeNode): Map<string, string> {
  const titles = new Map<string, string>();
  for (const node of flattenTree(root)) {
    titles.set(node.id, node.title || node.id);
  }
  return titles;
}

async function renderPublishableContents(
  root: TreeNode,
  titles: Map<string, string>,
  store: ImageStore,
  imageReport: ImageReport,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  for (const node of flattenTree(root)) {
    if (!node.ready) continue;

    const { markdown: transformed } = transformPageMarkdown(
      node.markdown,
      titles,
    );

    const withImages = await processImagesInMarkdown(
      transformed,
      store,
      node.id,
      node.title,
      imageReport,
    );

    const fileBody = renderPageFile(
      { id: node.id, title: node.title || "(untitled)" },
      withImages,
    );
    contents.set(node.id, fileBody);
  }
  return contents;
}

async function main(): Promise<void> {
  const argId = process.argv[2];
  const rootId = argId ?? NOTION_ROOT_PAGE_ID;
  if (!rootId) {
    error("no root page id. Pass one as argv[2] or set NOTION_ROOT_PAGE_ID in .env");
    process.exit(1);
  }

  log(`Walking tree from ${rootId}...`);
  const startWalk = performance.now();
  const root = await walkTree(rootId);
  const all = flattenTree(root);
  const publishable = all.filter((n) => n.ready);
  log(
    `Walked ${all.length} pages (${publishable.length} ready, ${all.length - publishable.length} draft) in ${(performance.now() - startWalk).toFixed(0)}ms`,
  );

  const titles = buildTitleMap(root);
  const paths = buildPaths(root);
  const store = makeImageStore();
  const imageReport = makeEmptyReport();

  log("Transforming markdown + downloading images...");
  const startRender = performance.now();
  const contents = await renderPublishableContents(
    root,
    titles,
    store,
    imageReport,
  );
  log(
    `Rendered ${contents.size} pages in ${(performance.now() - startRender).toFixed(0)}ms`,
  );
  log(
    `Images: ${imageReport.downloaded} downloaded, ${imageReport.reused} reused, ${imageReport.failed.length} failed (${(imageReport.bytes / 1024).toFixed(0)} KB)`,
  );
  if (imageReport.failed.length > 0) {
    for (const f of imageReport.failed) {
      error(`image fetch failed: ${f.url} (${f.error})`);
    }
  }

  // Build the desired set: only publishable pages get their content written.
  // 🚧 pages get their paths computed (so a future ✅ promotion finds the
  // right path), but we don't include them in the action set yet.
  const desired = new Map(
    publishable.map((n) => {
      const info = paths.get(n.id);
      if (!info) throw new Error(`buildPaths missed pageId ${n.id}`);
      return [n.id, info];
    }),
  );

  const everyPageInTree = new Set(all.map((n) => n.id));

  const existing = await globExistingFiles(DOCS_ROOT);

  // Filter out existing files that map to 🚧 pages — preserve those.
  const existingForActions = new Map<string, string>();
  for (const [id, abs] of existing) {
    if (everyPageInTree.has(id) && !desired.has(id)) {
      // Page is 🚧 in tree — preserve its existing file untouched.
      continue;
    }
    existingForActions.set(id, abs);
  }

  log(`Planning actions against ${DOCS_ROOT}...`);
  const actions = planActions(desired, existingForActions, contents, DOCS_ROOT);
  const summary = await applyActions(actions, DOCS_ROOT);
  log(
    `Files: ${summary.written} written, ${summary.unchanged} unchanged, ${summary.moved} moved, ${summary.deleted} deleted`,
  );

  log("Writing _category_.json files...");
  const categoryFiles = await writeCategoryJsonFiles(root, paths, DOCS_ROOT);
  log(`Wrote ${categoryFiles.length} _category_.json files`);

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
