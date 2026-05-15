// Emit `.canonical-slugs.json` at repo root after a successful sync.
//
// The canonical-slug Docusaurus hook reads this manifest at build time to
// compute per-page URLs (`/<section-slug>-<sectionId>/.../<page-slug>-<pageId>`).
// The pipeline writes structural data + EN titles. For Sprint C, the EN
// titles are used as ancestor labels in every locale; Phase 4.5 will extend
// the hook to read per-locale title overrides from `i18n/<locale>/...` files.

import { writeFile } from "node:fs/promises";
import type { Pages } from "./walk-tree.ts";

export type ManifestEntry = {
  title: string;
  parentId: string | null;
  ancestorIds: string[];
  isSection: boolean;
  isRoot: boolean;
};

export type Manifest = {
  version: 1;
  rootId: string;
  pages: Record<string, ManifestEntry>;
};

export type WriteManifestOptions = {
  manifestPath: string;
};

export function buildManifest(pages: Pages): Manifest {
  let rootId: string | null = null;
  const sorted = [...pages.values()].sort((a, b) => a.id.localeCompare(b.id));
  const entries: Record<string, ManifestEntry> = {};

  for (const page of sorted) {
    if (page.parentId === null) {
      if (rootId && rootId !== page.id) {
        throw new Error(
          `Multiple root pages found in tree: ${rootId} and ${page.id}`,
        );
      }
      rootId = page.id;
    }
    entries[page.id] = {
      title: page.title,
      parentId: page.parentId,
      ancestorIds: page.ancestorIds,
      isSection: page.childIds.length > 0,
      isRoot: page.parentId === null,
    };
  }

  if (!rootId) {
    throw new Error("buildManifest: no root page found");
  }

  return { version: 1, rootId, pages: entries };
}

export async function writeManifest(
  manifest: Manifest,
  options: WriteManifestOptions,
): Promise<void> {
  await writeFile(
    options.manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}
