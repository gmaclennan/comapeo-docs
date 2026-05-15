// Generate Docusaurus `_category_.json` files per section directory.
// See tree-publish-plan §5: "Section landing edge cases" + `_category_.json` table.
//
// One file per section directory, written alongside the section's own .md file.
// label/position come from the section page; link.id is the section page's
// pageId so Docusaurus renders the section landing as a doc, not a category index.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TreeNode } from "./walk-tree.ts";
import type { PathInfo } from "./paths.ts";

export type CategoryJson = {
  label: string;
  position: number;
  link: { type: "doc"; id: string } | { type: "generated-index" };
};

export function buildCategoryJson(section: TreeNode): CategoryJson {
  // If the section page itself is 🚧, fall back to Docusaurus's generated index.
  // The plan would normally preserve a last-✅ snapshot, but Sprint B doesn't
  // yet track that state — so we conservatively use generated-index whenever
  // the section landing doc would otherwise be missing.
  if (!section.ready) {
    return {
      label: section.title || "(untitled)",
      position: section.position,
      link: { type: "generated-index" },
    };
  }
  // Section is ✅: section page acts as the section landing.
  return {
    label: section.title || "(untitled)",
    position: section.position,
    link: { type: "doc", id: section.id },
  };
}

/**
 * Write `_category_.json` for every section directory in the tree.
 *
 * Returns the absolute paths written (for the manifest's awareness so it
 * doesn't delete them later).
 */
export async function writeCategoryJsonFiles(
  root: TreeNode,
  paths: Map<string, PathInfo>,
  docsRoot: string,
): Promise<string[]> {
  const written: string[] = [];
  await walkSections(root, paths, docsRoot, written);
  return written;
}

async function walkSections(
  node: TreeNode,
  paths: Map<string, PathInfo>,
  docsRoot: string,
  written: string[],
): Promise<void> {
  if (node.children.length > 0 && node.parentId !== null) {
    const info = paths.get(node.id);
    if (!info) {
      throw new Error(
        `writeCategoryJsonFiles: missing path info for section ${node.id}`,
      );
    }
    const absFilePath = join(docsRoot, info.relPath);
    const dir = dirname(absFilePath);
    await mkdir(dir, { recursive: true });
    const categoryPath = join(dir, "_category_.json");
    const json = buildCategoryJson(node);
    await writeFile(categoryPath, JSON.stringify(json, null, 2) + "\n", "utf8");
    written.push(categoryPath);
  }
  for (const child of node.children) {
    await walkSections(child, paths, docsRoot, written);
  }
}
