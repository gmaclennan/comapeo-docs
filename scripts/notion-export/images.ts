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

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

const HTML_SRC_RE = /<(?:img|video|audio|file|pdf)\s[^>]*\bsrc="([^"]+)"[^>]*\/?>/gi;

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

export type ImageReport = {
  total: number;
  downloaded: number;
  reused: number;
  failed: Array<{ url: string; error: string }>;
  bytes: number;
  lint: ImageLint[];
};

export function makeEmptyReport(): ImageReport {
  return {
    total: 0,
    downloaded: 0,
    reused: 0,
    failed: [],
    bytes: 0,
    lint: [],
  };
}

/**
 * Replace image URLs in the markdown body with public ImageStore URLs.
 * Mutates the report with download counts and lint entries.
 *
 * pageId + pageTitle are used only for lint-report attribution.
 */
export async function processImagesInMarkdown(
  markdown: string,
  store: ImageStore,
  pageId: string,
  pageTitle: string,
  report: ImageReport,
): Promise<string> {
  const replacements = new Map<string, string>();

  // Collect all image URLs from markdown image syntax and HTML media tags.
  const allUrls = new Set<string>();

  for (const m of markdown.matchAll(IMAGE_RE)) {
    allUrls.add(m[2]);
  }
  for (const m of markdown.matchAll(HTML_SRC_RE)) {
    allUrls.add(m[1]);
  }

  for (const url of allUrls) {
    report.total += 1;
    const category = categorizeUrl(url);

    if (category !== "notion-hosted") {
      if (category === "file" || category === "bare-filename") {
        report.lint.push({ pageId, pageTitle, category, url });
      }
      continue;
    }

    try {
      const res = await imageFetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "";
      const ext = extFromContentType(contentType) ?? extFromUrl(url);
      const sha = createHash("sha256").update(buf).digest("hex").slice(0, 12);
      const key = `${sha}${ext}`;

      let publicUrl: string;
      if (await store.has(key)) {
        publicUrl = store.urlFor(key);
        report.reused += 1;
      } else {
        publicUrl = await store.put(key, buf, contentType);
        report.downloaded += 1;
        report.bytes += buf.length;
      }
      replacements.set(url, publicUrl);
    } catch (err) {
      report.failed.push({
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Apply replacements via two passes (markdown image syntax + HTML media tags).
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
