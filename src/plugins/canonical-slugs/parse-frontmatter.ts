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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParseFrontMatter } from "@docusaurus/types";
import type { Manifest } from "../../../scripts/notion-export/manifest.ts";
import { computeSlug } from "./compute-slug.ts";

// File-anchor the manifest path so `docusaurus build` from a subdir (or any
// other tool wrapping Docusaurus with a non-repo-root cwd) finds it.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MANIFEST_PATH = resolve(REPO_ROOT, ".canonical-slugs.json");

const PAGEID_RE = /\/([0-9a-f]{32})\.mdx?$/;

type Cache = { manifest: Manifest; titles: Map<string, string> };

// Cached once per process. If the pipeline re-runs while `pnpm dev` is up,
// restart dev to pick up the new manifest.
let cached: Cache | null = null;
let warnedMissing = false;

function loadCache(): Cache | null {
  if (cached) return cached;
  let raw: string;
  try {
    raw = readFileSync(MANIFEST_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (!warnedMissing) {
        console.warn(
          "[canonical-slugs] .canonical-slugs.json missing — slug injection disabled. Run `pnpm notion:export` to generate it.",
        );
        warnedMissing = true;
      }
      return null;
    }
    throw err;
  }
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
  return m ? m[1] : null;
}

export const parseFrontMatterWithSlug: ParseFrontMatter = async (params) => {
  const result = await params.defaultParseFrontMatter({
    filePath: params.filePath,
    fileContent: params.fileContent,
  });

  const pageId = pageIdFromPath(params.filePath);
  if (!pageId) return result;

  const cache = loadCache();
  if (!cache || !cache.manifest.pages[pageId]) return result;

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
};
