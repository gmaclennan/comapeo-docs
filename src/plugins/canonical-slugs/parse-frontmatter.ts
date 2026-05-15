// Custom `parseFrontMatter` for the Docusaurus docs preset.
//
// Runs once per .md/.mdx file at content-load time, BEFORE the docs plugin
// determines the doc's route. We default-parse the file's frontmatter, then
// look up the canonical slug for its pageId and inject `slug:` into the
// returned frontmatter object.
//
// The slug is derived from the localized title + the ancestor chain (per
// tree-publish-plan §3). Phase 4.5 will extend the title lookup to read
// translated titles from `i18n/<locale>/...` files; for Sprint C the
// manifest's EN titles are used everywhere.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "../../../scripts/notion-export/manifest.ts";
import { computeSlug } from "./compute-slug.ts";

const MANIFEST_PATH = resolve(".canonical-slugs.json");
const PAGEID_RE = /\/([0-9a-f]{32})\.mdx?$/i;

type Cache = { manifest: Manifest; titles: Map<string, string> };

let cached: Cache | null = null;

function loadCache(): Cache {
  if (cached) return cached;
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw) as Manifest;
  const titles = new Map<string, string>();
  for (const [id, entry] of Object.entries(manifest.pages)) {
    titles.set(id, entry.title);
  }
  cached = { manifest, titles };
  return cached;
}

function pageIdFromPath(filePath: string): string | null {
  const m = filePath.match(PAGEID_RE);
  return m ? m[1].toLowerCase() : null;
}

type DefaultParser = (params: {
  filePath: string;
  fileContent: string;
}) => Promise<{
  frontMatter: { [key: string]: unknown };
  content: string;
}>;

type ParseParams = {
  filePath: string;
  fileContent: string;
  defaultParseFrontMatter: DefaultParser;
};

export async function parseFrontMatterWithSlug(
  params: ParseParams,
): Promise<{ frontMatter: { [key: string]: unknown }; content: string }> {
  const result = await params.defaultParseFrontMatter({
    filePath: params.filePath,
    fileContent: params.fileContent,
  });

  const pageId = pageIdFromPath(params.filePath);
  if (!pageId) return result;

  let cache: Cache;
  try {
    cache = loadCache();
  } catch {
    // Manifest missing — happens before the first pipeline run. Skip slug
    // injection silently so `pnpm dev` still works on an empty docs tree.
    return result;
  }

  if (!cache.manifest.pages[pageId]) return result;

  // If this file's frontmatter has a title, use it for ITS OWN pageId so
  // the slug reflects local edits (or Weblate translations in Phase 4.5).
  // Ancestor titles come from the cached manifest titles.
  const titlesForThisFile =
    typeof result.frontMatter.title === "string"
      ? new Map(cache.titles).set(pageId, result.frontMatter.title)
      : cache.titles;

  const slug = computeSlug({
    pageId,
    manifest: cache.manifest,
    titlesByPageId: titlesForThisFile,
  });

  return {
    ...result,
    frontMatter: { ...result.frontMatter, slug },
  };
}
