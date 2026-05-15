// Generate Docusaurus `_category_.json` files per section directory.
// See tree-publish-plan §5: "Section landing edge cases" + `_category_.json` table.
//
// One file per section directory, written alongside the section's own .md file.
// label/position come from the section page; link.id is the section page's
// pageId so Docusaurus renders the section landing as a doc. When the section
// page itself is 🚧, fall back to Docusaurus's generated-index.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page, Pages } from "./walk-tree.ts";

export type CategoryJson = {
  label: string;
  position: number;
  link: { type: "doc"; id: string } | { type: "generated-index" };
};

export type WriteCategoryOptions = {
  docsDir: string;
};

/**
 * Derive a Docusaurus doc id from a page's relative file path.
 * Matches Docusaurus's default rule (path-without-extension relative to docs/).
 */
function docIdFromRelPath(relPath: string): string {
  return relPath.replace(/\.mdx?$/, "");
}

export function buildCategoryJson(section: Page): CategoryJson {
  if (!section.ready || !section.relPath) {
    // Section page itself isn't ✅ — Sprint B doesn't yet preserve a last-✅
    // snapshot, so we conservatively fall back to a generated index rather
    // than link to a doc that doesn't exist.
    return {
      label: section.title || "(untitled)",
      position: section.position,
      link: { type: "generated-index" },
    };
  }
  return {
    label: section.title || "(untitled)",
    position: section.position,
    link: { type: "doc", id: docIdFromRelPath(section.relPath) },
  };
}

export async function writeCategoryConfig(
  pages: Pages,
  options: WriteCategoryOptions,
): Promise<number> {
  let written = 0;
  for (const page of pages.values()) {
    // Sections are non-root pages with children.
    if (page.parentId === null) continue;
    if (page.childIds.length === 0) continue;
    if (!page.relPath) continue;

    const sectionFileAbs = join(options.docsDir, page.relPath);
    const dir = dirname(sectionFileAbs);
    await mkdir(dir, { recursive: true });
    const categoryPath = join(dir, "_category_.json");
    const json = buildCategoryJson(page);
    await writeFile(categoryPath, JSON.stringify(json, null, 2) + "\n", "utf8");
    written += 1;
  }
  return written;
}
