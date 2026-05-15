// Pure slug computation: given a pageId and a per-locale title map,
// produce the canonical URL slug.
//
// Per tree-publish-plan §3:
//   Root → "/"
//   Anything else → "/<a1-slug>-<a1-id>/.../<this-slug>-<this-id>"
//
// where each segment's slug comes from slugify(title) in the relevant locale.
// PageIds are stable across locales; only slug prefixes translate.

import slugify from "@sindresorhus/slugify";
import type { Manifest } from "../../../scripts/notion-export/manifest.ts";

const MAX_SLUG_LEN = 60;

function slugSegment(title: string): string {
  if (!title) return "untitled";
  const out = slugify(title, { lowercase: true });
  return out.length > MAX_SLUG_LEN ? out.slice(0, MAX_SLUG_LEN) : out;
}

export type SlugInput = {
  pageId: string;
  /** Tree structure + isRoot flags. */
  manifest: Manifest;
  /** Per-locale titles. Falls back to `manifest.pages[id].title` if missing. */
  titlesByPageId: Map<string, string>;
};

export function computeSlug(input: SlugInput): string {
  const { pageId, manifest, titlesByPageId } = input;
  const entry = manifest.pages[pageId];
  if (!entry) {
    throw new Error(`computeSlug: pageId ${pageId} not in manifest`);
  }
  if (entry.isRoot) return "/";

  const titleOf = (id: string): string => {
    const localized = titlesByPageId.get(id);
    if (localized !== undefined) return localized;
    return manifest.pages[id]?.title ?? id;
  };

  const segments: string[] = [];
  for (const ancestorId of entry.ancestorIds) {
    const ancestor = manifest.pages[ancestorId];
    if (!ancestor || ancestor.isRoot) continue;
    segments.push(`${slugSegment(titleOf(ancestorId))}-${ancestorId}`);
  }
  segments.push(`${slugSegment(titleOf(pageId))}-${pageId}`);
  return "/" + segments.join("/");
}
