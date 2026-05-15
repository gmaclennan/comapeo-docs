// Image (and file) handling per transforms-plan §5.
//
// Pluggable ImageStore interface. Currently only LocalImageStore is implemented.
// R2ImageStore is mentioned in the plan as a future swap-in without changing
// the transform layer.
//
// URLs are categorized per transforms-plan §12 before download:
//   - notion-hosted: download to ImageStore, rewrite URL to public path
//   - external: leave alone (wikipedia, public CDN, etc.)
//   - file:// : log warning, leave alone (broken; pre-existing data hygiene issue)
//   - bare-filename: log warning, leave alone (broken; pre-existing data hygiene issue)

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pipeline, withConcurrency, withRetry } from "fetch-extras";
import { fetchBlock } from "./fetch.ts";
import { resolveFileAttachmentUrl } from "./file-attachments.ts";
import type { Page } from "./walk-tree.ts";

export interface ImageStore {
  /** Has an object with this key already been stored? */
  has(key: string): Promise<boolean>;
  /** Store the bytes; return the PUBLIC URL the image will be served at. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** Resolve a key to its public URL without I/O. */
  urlFor(key: string): string;
}

export class LocalImageStore implements ImageStore {
  private outDir: string;
  private publicPrefix: string;

  constructor(outDir: string, publicPrefix: string) {
    this.outDir = outDir;
    this.publicPrefix = publicPrefix;
  }

  async has(key: string): Promise<boolean> {
    return existsSync(join(this.outDir, key));
  }

  async put(
    key: string,
    bytes: Uint8Array,
    _contentType: string,
  ): Promise<string> {
    await mkdir(this.outDir, { recursive: true });
    await writeFile(join(this.outDir, key), bytes);
    return this.urlFor(key);
  }

  urlFor(key: string): string {
    return `${this.publicPrefix}/${key}`;
  }
}

/**
 * Factory: returns LocalImageStore for now. When R2_ACCOUNT_ID is set in env,
 * swap in R2ImageStore (not yet implemented).
 */
export function makeImageStore(): ImageStore {
  return new LocalImageStore("static/images/notion", "/images/notion");
}

// Markdown image URL matcher. Two alternatives because file:// URLs from
// Notion contain unescaped `(` and `)` in filenames (e.g. `_a_la(s).png`)
// — the simple `[^)]+` would truncate mid-URL. file:// URLs always end with
// the URL-encoded JSON close `%7D`, so we anchor on that.
const IMAGE_RE = /!\[([^\]]*)\]\((file:[^\s"<>]*?%7D|[^)]+)\)/g;

const HTML_SRC_RE = /<(?:img|video|audio|file|pdf)\s[^>]*\bsrc="([^"]+)"[^>]*\/?>/gi;

// Standalone file:// URL matcher for the pre-resolution pass.
const FILE_URL_IN_IMAGE_RE = /!\[([^\]]*)\]\((file:[^\s"<>]*?%7D)\)/g;

export type UrlCategory =
  | "notion-hosted"
  | "external"
  | "file"
  | "bare-filename";

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
  const { store, page } = options;
  const replacements = new Map<string, string>();
  const work: ImageWork = {
    markdown,
    downloaded: 0,
    reused: 0,
    failed: [],
    bytes: 0,
    lint: [],
  };

  // Pre-pass: resolve file:// URLs to Notion-hosted S3 URLs via the block
  // API. If the resolver returns null (malformed, missing block, etc.), the
  // URL stays as `file://...` and falls through to the lint-warning branch
  // below — same fallback behaviour as before this pass existed.
  const resolved = await resolveFileUrls(markdown);
  markdown = resolved.markdown;
  work.markdown = markdown;

  const allUrls = new Set<string>();
  for (const m of markdown.matchAll(IMAGE_RE)) allUrls.add(m[2]);
  for (const m of markdown.matchAll(HTML_SRC_RE)) allUrls.add(m[1]);

  for (const url of allUrls) {
    const category = categorizeUrl(url);

    if (category !== "notion-hosted") {
      if (category === "file" || category === "bare-filename") {
        work.lint.push({
          pageId: page.id,
          pageTitle: page.title,
          category,
          url,
        });
      }
      continue;
    }

    try {
      const res = await imageFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "";
      const ext = extFromContentType(contentType) ?? extFromUrl(url);
      const sha = createHash("sha256").update(buf).digest("hex").slice(0, 12);
      const key = `${sha}${ext}`;

      let publicUrl: string;
      if (await store.has(key)) {
        publicUrl = store.urlFor(key);
        work.reused += 1;
      } else {
        publicUrl = await store.put(key, buf, contentType);
        work.downloaded += 1;
        work.bytes += buf.length;
      }
      replacements.set(url, publicUrl);
    } catch (err) {
      work.failed.push({
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let out = markdown.replace(IMAGE_RE, (whole, alt: string, url: string) => {
    const replaced = replacements.get(url);
    return replaced ? `![${alt}](${replaced})` : whole;
  });

  out = out.replace(HTML_SRC_RE, (whole, url: string) => {
    const replaced = replacements.get(url);
    if (!replaced) return whole;
    return whole.replace(`src="${url}"`, `src="${replaced}"`);
  });

  work.markdown = out;
  return work;
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
