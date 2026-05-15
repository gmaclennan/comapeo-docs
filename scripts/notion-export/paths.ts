// Compute filesystem paths and directory segments for each Page.
//
// Filesystem layout (per tree-publish-plan §3):
//   docs/<rootPageId>.md
//   docs/<section-slug>/<sectionPageId>.md
//   docs/<section-slug>/<articlePageId>.md
//   docs/<section-slug>/<sub-section-slug>/<grandchildPageId>.md
//
// Directory names are slugified from the EN section title. File names are
// always <pageId>.md so renames in Notion don't rename files.
//
// Mutates each Page: sets `relPath` and `dirSegments`. Throws on sibling-
// section directory collisions.

import slugify from "@sindresorhus/slugify";
import type { Page, Pages } from "./walk-tree.ts";

export type ComputePathsOptions = Record<string, never>;

function dirSlug(title: string): string {
  return title ? slugify(title, { lowercase: true }) : "untitled";
}

function isSection(page: Page): boolean {
  return page.childIds.length > 0;
}

export function computePagePaths(pages: Pages, _options: ComputePathsOptions): void {
  // Compute dirSegments per page. A page's dirSegments are formed from its
  // ANCESTOR sections' titles (not its own — its own slug only affects its
  // children's path). For root, dirSegments is empty.
  for (const page of pages.values()) {
    const segments: string[] = [];
    for (const ancestorId of page.ancestorIds) {
      const ancestor = pages.get(ancestorId);
      if (!ancestor) continue;
      // Root never contributes a dir segment (lives at docs/<rootId>.md).
      if (ancestor.parentId === null) continue;
      if (!isSection(ancestor)) continue;
      segments.push(dirSlug(ancestor.title));
    }
    page.dirSegments = segments;
    page.relPath =
      segments.length === 0
        ? `${page.id}.md`
        : `${segments.join("/")}/${page.id}.md`;
  }

  // Sibling-section collision check: two sections under the same parent
  // can't share a directory name (Docusaurus i18n requires consistent path
  // structure across locales).
  const groups = new Map<string, Page[]>();
  for (const page of pages.values()) {
    if (page.parentId === null) continue;
    if (!isSection(page)) continue;
    const key = `${page.parentId}:${dirSlug(page.title)}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(page);
  }
  for (const [, group] of groups) {
    if (group.length > 1) {
      const conflicts = group
        .map((p) => `${p.title} (${p.id})`)
        .join(", ");
      throw new Error(
        `Two or more sibling sections would share directory '${dirSlug(group[0].title)}': ${conflicts}. Rename one in Notion.`,
      );
    }
  }
}
