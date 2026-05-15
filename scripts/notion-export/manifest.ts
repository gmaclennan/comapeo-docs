// Emit `.canonical-slugs.json` at repo root after a successful sync.
//
// The canonical-slug Docusaurus plugin reads this manifest at build time to
// compute per-locale URLs (`/<section-slug>-<sectionId>/.../<page-slug>-<pageId>`).
// The pipeline writes structural data + EN titles; for non-EN locales the
// plugin overrides titles by reading `i18n/<locale>/...` files at build time
// (stubbed in Sprint C; wired in Phase 4.5 with Weblate).

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
  pages: Pages,
  options: WriteManifestOptions,
): Promise<void> {
  const manifest = buildManifest(pages);
  await writeFile(
    options.manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}
