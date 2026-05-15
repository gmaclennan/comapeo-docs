// Compute the desired filesystem path for each page in the walked tree.
//
// Filesystem layout (per tree-publish-plan §3):
//   docs/<rootPageId>.md
//   docs/<section-slug>/<sectionPageId>.md
//   docs/<section-slug>/<articlePageId>.md
//   docs/<section-slug>/<sub-section-slug>/<grandchildPageId>.md
//
// Directory names are slugified from the section page's English title.
// File names are always <pageId>.md so renames in Notion never rename files.

import slugify from "@sindresorhus/slugify";
import type { TreeNode } from "./walk-tree.ts";

export type PathInfo = {
  id: string;
  /** Path relative to docs/, e.g. "getting-started/<pageId>.md". */
  relPath: string;
  /** Just the directory portion, e.g. "getting-started". Empty for root + top-level pages. */
  dir: string;
  isRoot: boolean;
  /** True if this page has any children (i.e. acts as a section). */
  isSection: boolean;
};

const DOCS_DIR = "docs";

function dirSlug(title: string): string {
  if (!title) return "untitled";
  return slugify(title, { lowercase: true });
}

/**
 * Build a Map<pageId, PathInfo> for every node in the tree.
 *
 * Throws if two sibling sections would share the same directory slug.
 */
export function buildPaths(root: TreeNode): Map<string, PathInfo> {
  const paths = new Map<string, PathInfo>();
  walk(root, [], paths);
  return paths;
}

function walk(
  node: TreeNode,
  ancestorDirs: string[],
  paths: Map<string, PathInfo>,
): void {
  const isRoot = node.parentId === null;
  const isSection = node.children.length > 0;

  if (isRoot) {
    paths.set(node.id, {
      id: node.id,
      relPath: `${node.id}.md`,
      dir: "",
      isRoot: true,
      isSection,
    });
  } else {
    const dir = ancestorDirs.join("/");
    paths.set(node.id, {
      id: node.id,
      relPath: dir ? `${dir}/${node.id}.md` : `${node.id}.md`,
      dir,
      isRoot: false,
      isSection,
    });
  }

  if (isSection) {
    // Collision detection across sibling section directories.
    const siblingDirSlugs = new Map<string, TreeNode>();
    for (const child of node.children) {
      if (child.children.length === 0) continue;
      const slug = dirSlug(child.title);
      const existing = siblingDirSlugs.get(slug);
      if (existing) {
        throw new Error(
          `Two sibling sections would share directory '${slug}': ` +
            `${existing.title} (${existing.id}) and ${child.title} (${child.id}). ` +
            `Rename one in Notion.`,
        );
      }
      siblingDirSlugs.set(slug, child);
    }

    for (const child of node.children) {
      const childDirs = isRoot
        ? child.children.length > 0
          ? [dirSlug(child.title)]
          : []
        : child.children.length > 0
          ? [...ancestorDirs, dirSlug(child.title)]
          : [...ancestorDirs];
      walk(child, childDirs, paths);
    }
  }
}

export function fullPath(info: PathInfo): string {
  return `${DOCS_DIR}/${info.relPath}`;
}
