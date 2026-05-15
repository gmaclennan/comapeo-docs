import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import pLimit from "p-limit";

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const limit = pLimit(5);

export type ImageReport = {
  total: number;
  downloaded: number;
  failed: Array<{ url: string; error: string }>;
  bytes: number;
};

function extFromUrl(url: string, contentType?: string | null): string {
  const fromContent = contentType?.split(";")[0].trim();
  if (fromContent === "image/webp") return ".webp";
  if (fromContent === "image/png") return ".png";
  if (fromContent === "image/jpeg") return ".jpg";
  if (fromContent === "image/gif") return ".gif";
  if (fromContent === "image/svg+xml") return ".svg";

  try {
    const path = new URL(url).pathname;
    const ext = extname(path).toLowerCase();
    if (ext) return ext;
  } catch {}
  return ".bin";
}

async function downloadOne(
  url: string,
  outDir: string
): Promise<{ filename: string; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash("sha1").update(buf).digest("hex").slice(0, 12);
  const ext = extFromUrl(url, res.headers.get("content-type"));
  const filename = `${hash}${ext}`;
  await writeFile(join(outDir, filename), buf);
  return { filename, bytes: buf.length };
}

export async function downloadImages(
  markdown: string,
  outDir: string,
  publicPrefix: string
): Promise<{ markdown: string; report: ImageReport }> {
  await mkdir(outDir, { recursive: true });

  const matches = [...markdown.matchAll(IMAGE_RE)];
  const report: ImageReport = {
    total: matches.length,
    downloaded: 0,
    failed: [],
    bytes: 0,
  };

  const replacements = new Map<string, string>();

  await Promise.all(
    matches.map((match) =>
      limit(async () => {
        const url = match[2];
        if (replacements.has(url)) return;
        if (!/^https?:\/\//.test(url)) return;
        try {
          const { filename, bytes } = await downloadOne(url, outDir);
          replacements.set(url, `${publicPrefix}/${filename}`);
          report.downloaded += 1;
          report.bytes += bytes;
        } catch (err) {
          report.failed.push({
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    )
  );

  const out = markdown.replace(IMAGE_RE, (whole, alt, url) => {
    const replaced = replacements.get(url);
    return replaced ? `![${alt}](${replaced})` : whole;
  });

  return { markdown: out, report };
}
