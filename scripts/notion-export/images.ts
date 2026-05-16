// Per-page image handling: discover → categorize → download → rewrite.
//
// Notion's Markdown Content API emits image refs in two shapes:
//   - `![alt](url)` for image blocks (99.3% of refs in the CoMapeo corpus)
//   - `<video|audio|file|pdf src="...">` for other media (rare; corpus showed
//     one each, all external). Notion never emits `<img>`.
//
// URLs are categorized per transforms-plan §12:
//   - notion-hosted: download via ImageStore, rewrite URL to public path
//   - external: leave alone (wikipedia, public CDN, etc.)
//   - file://: pre-resolved via resolveFileUrls (block API). Resolver failures
//     fall through to the lint branch.
//   - bare-filename: lint warning, leave alone (pre-existing data hygiene).
//
// See SKILL.md §Media and findings.md for the empirical basis.

import { createHash } from "node:crypto";
import { extname } from "node:path";
import { pipeline, withConcurrency, withRetry } from "fetch-extras";
import { fetchBlock } from "./fetch.ts";
import { resolveFileAttachmentUrl } from "./file-attachments.ts";
import type { ImageStore } from "./image-store.ts";
import type { Page } from "./walk-tree.ts";

// === Regexes ============================================================

// Two alternatives because file:// URLs from Notion contain unescaped `(`/`)`
// in filenames (e.g. `_a_la(s).png`); the simple `[^)]+` would truncate
// mid-URL. file:// URLs always end with the URL-encoded JSON close `%7D`.
const IMAGE_RE = /!\[([^\]]*)\]\((file:[^\s"<>]*?%7D|[^)]+)\)/g;

// `<img>` is intentionally absent — Notion never emits it (SKILL.md §Media).
const HTML_SRC_RE = /<(?:video|audio|file|pdf)\s[^>]*\bsrc="([^"]+)"[^>]*\/?>/gi;

// Full-element matcher (opening + content + matching close). Used by
// `applyMissingImageMarkers` to swap the whole element for a marker div —
// the src-only swap in `applyReplacements` would leave an orphaned
// `cap</video>` tail when the element is replaced wholesale.
const HTML_ELEMENT_RE =
  /<(video|audio|file|pdf)\s[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/\1\s*>/gi;

// Standalone file:// URL matcher for the pre-resolution pass.
const FILE_URL_IN_IMAGE_RE = /!\[([^\]]*)\]\((file:[^\s"<>]*?%7D)\)/g;

// === Types ==============================================================

export type UrlCategory =
  | "notion-hosted"
  | "external"
  | "file"
  | "bare-filename";

export type ImageRef = {
  url: string;
  syntax: "markdown" | "html";
};

type DownloadableRef = ImageRef & { category: "notion-hosted" };

export type ImageLint = {
  pageId: string;
  pageTitle: string;
  category: UrlCategory;
  url: string;
};

export type ImageWork = {
  /** Markdown with notion-hosted image URLs rewritten to public store URLs. */
  markdown: string;
  downloaded: number;
  reused: number;
  failed: Array<{ url: string; error: string }>;
  bytes: number;
  lint: ImageLint[];
};

export type ProcessImagesOptions = {
  store: ImageStore;
  page: Page;
};

// === Pure helpers =======================================================

export function categorizeUrl(url: string): UrlCategory {
  if (url.startsWith("file:")) return "file";
  if (!/^https?:\/\//i.test(url)) return "bare-filename";
  try {
    const host = new URL(url).hostname;
    if (
      host.endsWith("notion.so") ||
      host.endsWith("notion.site") ||
      host.endsWith("amazonaws.com") ||
      host.endsWith("amazonaws.com.cn")
    ) {
      return "notion-hosted";
    }
    return "external";
  } catch {
    return "bare-filename";
  }
}

/**
 * Extract every image/media URL reference from a page's markdown. Duplicates
 * are returned (one entry per occurrence) — de-duplication happens during
 * download, but lint reporting wants every occurrence.
 */
export function extractImageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const m of markdown.matchAll(IMAGE_RE)) {
    refs.push({ url: m[2], syntax: "markdown" });
  }
  for (const m of markdown.matchAll(HTML_SRC_RE)) {
    refs.push({ url: m[1], syntax: "html" });
  }
  return refs;
}

/**
 * Split image refs into a download list (notion-hosted only) plus a lint
 * list (file:// that didn't resolve, bare filenames). External URLs are
 * pass-through and don't need either; they're dropped here.
 *
 * Notion-hosted refs are de-duped — one entry per unique URL — so the
 * caller can use a Map. Lint entries preserve every occurrence.
 */
export function classifyRefs(
  refs: ImageRef[],
  page: Page,
): { downloadable: DownloadableRef[]; lint: ImageLint[] } {
  const downloadable: DownloadableRef[] = [];
  const seen = new Set<string>();
  const lint: ImageLint[] = [];

  for (const ref of refs) {
    const category = categorizeUrl(ref.url);
    if (category === "notion-hosted") {
      if (seen.has(ref.url)) continue;
      seen.add(ref.url);
      downloadable.push({ ...ref, category });
      continue;
    }
    if (category === "file" || category === "bare-filename") {
      lint.push({
        pageId: page.id,
        pageTitle: page.title,
        category,
        url: ref.url,
      });
    }
  }

  return { downloadable, lint };
}

function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  switch (mime) {
    case "image/webp":
      return ".webp";
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "image/avif":
      return ".avif";
    case "application/pdf":
      return ".pdf";
    case "video/mp4":
      return ".mp4";
    case "audio/mpeg":
      return ".mp3";
    default:
      return null;
  }
}

function extFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const ext = extname(path).toLowerCase();
    if (ext && /^\.[a-z0-9]+$/.test(ext)) return ext;
  } catch {
    // ignore
  }
  return ".bin";
}

const imageFetch = pipeline(
  fetch,
  withConcurrency({ maxConcurrentRequests: 5 }),
  withRetry({ retries: 2 }),
);

export type DownloadResult = {
  replacements: Map<string, string>;
  downloaded: number;
  reused: number;
  bytes: number;
  failed: Array<{ url: string; error: string }>;
};

/**
 * Fetch every downloadable ref, content-address it, store via the
 * ImageStore, and return a `oldUrl → publicUrl` replacement map.
 */
export async function downloadAll(
  refs: DownloadableRef[],
  store: ImageStore,
): Promise<DownloadResult> {
  const result: DownloadResult = {
    replacements: new Map(),
    downloaded: 0,
    reused: 0,
    bytes: 0,
    failed: [],
  };

  for (const ref of refs) {
    try {
      const res = await imageFetch(ref.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "";
      const ext = extFromContentType(contentType) ?? extFromUrl(ref.url);
      const sha = createHash("sha256").update(buf).digest("hex").slice(0, 12);
      const key = `${sha}${ext}`;

      let publicUrl: string;
      if (await store.has(key)) {
        publicUrl = store.urlFor(key);
        result.reused += 1;
      } else {
        publicUrl = await store.put(key, buf, contentType);
        result.downloaded += 1;
        result.bytes += buf.length;
      }
      result.replacements.set(ref.url, publicUrl);
    } catch (err) {
      result.failed.push({
        url: ref.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Rewrite the page body using the `oldUrl → publicUrl` map. Both markdown
 * `![alt](url)` and HTML `<video|audio|file|pdf src="url">` syntaxes are
 * substituted in place; any URL not in the map is left untouched.
 */
export function applyReplacements(
  markdown: string,
  replacements: Map<string, string>,
): string {
  let out = markdown.replace(IMAGE_RE, (whole, alt: string, url: string) => {
    const replaced = replacements.get(url);
    return replaced ? `![${alt}](${replaced})` : whole;
  });

  out = out.replace(HTML_SRC_RE, (whole, url: string) => {
    const replaced = replacements.get(url);
    if (!replaced) return whole;
    return whole.replace(`src="${url}"`, `src="${replaced}"`);
  });

  return out;
}

export type MissingImageCategory =
  | "fetch-failed"
  | "file-unresolved"
  | "bare-filename";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function missingImageMarker(
  url: string,
  category: MissingImageCategory,
): string {
  // Surround with blank lines so the block-level div doesn't end up nested
  // inside a paragraph (MDX would warn) when the original image was inline.
  return `\n\n<div data-notion-lint="missing-image" data-url="${escapeAttribute(url)}" data-category="${category}">⚠️ Missing image</div>\n\n`;
}

/**
 * Replace every image reference whose URL is in `markers` with a visible
 * `data-notion-lint="missing-image"` div. Pure rewrite — does no I/O.
 *
 * Pair with `applyReplacements`: run that first (rewrites successful
 * downloads), then this (rewrites the failure URLs that were left in
 * place). The two operate on disjoint URL sets so order is incidental but
 * conventional.
 */
export function applyMissingImageMarkers(
  markdown: string,
  markers: Map<string, MissingImageCategory>,
): string {
  if (markers.size === 0) return markdown;

  let out = markdown.replace(IMAGE_RE, (whole, _alt: string, url: string) => {
    const category = markers.get(url);
    return category ? missingImageMarker(url, category) : whole;
  });

  out = out.replace(HTML_ELEMENT_RE, (whole, _tag: string, url: string) => {
    const category = markers.get(url);
    return category ? missingImageMarker(url, category) : whole;
  });

  return out;
}

function buildMarkersMap(
  failed: Array<{ url: string }>,
  lint: ImageLint[],
): Map<string, MissingImageCategory> {
  const markers = new Map<string, MissingImageCategory>();
  for (const f of failed) markers.set(f.url, "fetch-failed");
  for (const l of lint) {
    markers.set(
      l.url,
      l.category === "file" ? "file-unresolved" : "bare-filename",
    );
  }
  return markers;
}

// === Orchestrator =======================================================

/**
 * Replace image URLs in the markdown body with public ImageStore URLs.
 *
 * Returns a per-page work record (counts + lint entries). The caller
 * aggregates across pages; nothing is logged or mutated outside the
 * returned value.
 *
 * `options.page` is used only for lint-report attribution (id + title).
 */
export async function processImagesInMarkdown(
  markdown: string,
  options: ProcessImagesOptions,
): Promise<ImageWork> {
  const resolved = await resolveFileUrls(markdown);
  const refs = extractImageRefs(resolved.markdown);
  const { downloadable, lint } = classifyRefs(refs, options.page);
  const dl = await downloadAll(downloadable, options.store);
  const markers = buildMarkersMap(dl.failed, lint);
  let out = applyReplacements(resolved.markdown, dl.replacements);
  out = applyMissingImageMarkers(out, markers);

  return {
    markdown: out,
    downloaded: dl.downloaded,
    reused: dl.reused,
    failed: dl.failed,
    bytes: dl.bytes,
    lint,
  };
}

/**
 * Find every `file://` URL in markdown image syntax and try to resolve each
 * one to a Notion-hosted S3 URL via the block API. Successful resolutions
 * are substituted in place; failures leave the original `file://` URL
 * (which then hits the lint-warning branch in `processImagesInMarkdown`).
 *
 * Exported for testing; the orchestrator calls `processImagesInMarkdown`
 * which uses this internally.
 */
export async function resolveFileUrls(
  markdown: string,
): Promise<{ markdown: string; resolved: number; unresolved: number }> {
  const matches = [...markdown.matchAll(FILE_URL_IN_IMAGE_RE)];
  if (matches.length === 0) {
    return { markdown, resolved: 0, unresolved: 0 };
  }

  // De-dupe identical URLs; resolve each once.
  const resolutions = new Map<string, string | null>();
  for (const m of matches) {
    const url = m[2];
    if (resolutions.has(url)) continue;
    resolutions.set(url, await resolveFileAttachmentUrl(url, fetchBlock));
  }

  let resolved = 0;
  let unresolved = 0;
  const out = markdown.replace(
    FILE_URL_IN_IMAGE_RE,
    (whole, alt: string, url: string) => {
      const replacement = resolutions.get(url);
      if (!replacement) {
        unresolved += 1;
        return whole;
      }
      resolved += 1;
      return `![${alt}](${replacement})`;
    },
  );
  return { markdown: out, resolved, unresolved };
}
