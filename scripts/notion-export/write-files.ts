// Sync the docs/ filesystem to match the pages map.
//
// Each .md file is named after its Notion pageId. Renames in Notion change
// the directory (slugified from ancestor titles) but NEVER the filename —
// so we detect moves by globbing `<pageId>.md` files and matching by id.
//
// Per tree-publish-plan §3:
//   - ✅ page with body         → write or move-then-write
//   - 🚧 page still in tree     → preserve existing file (last-✅ snapshot)
//   - page no longer in tree    → delete file (archived in Notion)

import {
  glob,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Pages } from "./walk-tree.ts";
import { log, warn } from "./logger.ts";

const PAGEID_FILENAME_RE = /(?:^|\/)([0-9a-f]{32})\.md$/;

export type SyncOptions = {
  docsDir: string;
};

export type SyncSummary = {
  written: number;
  moved: number;
  deleted: number;
  unchanged: number;
};

export async function syncFilesystem(
  pages: Pages,
  options: SyncOptions,
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    written: 0,
    moved: 0,
    deleted: 0,
    unchanged: 0,
  };
  const dirsTouched = new Set<string>();

  const existing = await globExistingFiles(options.docsDir);

  // Pass 1: handle every page in the tree.
  for (const page of pages.values()) {
    if (!page.relPath) {
      warn(`page ${page.id} missing relPath; skipping`);
      continue;
    }
    const destAbs = join(options.docsDir, page.relPath);
    const existingAbs = existing.get(page.id);

    // 🚧 page (no body): preserve existing file untouched.
    if (page.body === undefined) {
      existing.delete(page.id);
      continue;
    }

    // ✅ page: ensure file lives at destAbs with the right content.
    if (existingAbs && existingAbs !== destAbs) {
      await mkdir(dirname(destAbs), { recursive: true });
      await rename(existingAbs, destAbs);
      await writeFile(destAbs, page.body, "utf8");
      dirsTouched.add(dirname(existingAbs));
      log(
        `moved: ${relative(options.docsDir, existingAbs)} → ${relative(options.docsDir, destAbs)}`,
      );
      summary.moved += 1;
    } else {
      await mkdir(dirname(destAbs), { recursive: true });
      const current = await readFileOrNull(destAbs);
      if (current === page.body) {
        summary.unchanged += 1;
      } else {
        await writeFile(destAbs, page.body, "utf8");
        summary.written += 1;
      }
    }
    existing.delete(page.id);
  }

  // Pass 2: any remaining existing file is for a page no longer in the tree.
  for (const [, abs] of existing) {
    await rm(abs, { force: true });
    dirsTouched.add(dirname(abs));
    summary.deleted += 1;
  }
  if (summary.deleted > 0) {
    warn(`deleted ${summary.deleted} file(s) for archived pages`);
  }

  // Pass 3: best-effort empty-dir cleanup so renames don't leave debris.
  for (const dir of dirsTouched) {
    try {
      await rm(dir, { recursive: false });
    } catch {
      // dir still has files — leave it alone
    }
  }

  return summary;
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function globExistingFiles(docsDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for await (const entry of glob("**/[0-9a-f]*.md", { cwd: docsDir })) {
      const abs = join(docsDir, entry);
      const m = `/${entry}`.match(PAGEID_FILENAME_RE);
      if (!m) continue;
      const id = m[1];
      if (id.length !== 32) continue;
      map.set(id, abs);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return map;
}
