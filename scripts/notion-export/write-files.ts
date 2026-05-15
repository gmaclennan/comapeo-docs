// Filesystem manifest: glob existing pageId-keyed files under docs/, diff
// against desired paths, emit write/move/delete actions.
//
// Filenames are stable Notion pageIds (32 hex). When a page is renamed or
// moved in Notion, the slugified directory part changes but the filename
// stays — so we detect moves via filename match and rename via rename().
//
// Per tree-publish-plan §3.

import {
  glob,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { PathInfo } from "./paths.ts";
import { log, warn } from "./logger.ts";

const PAGEID_FILENAME_RE = /\/([0-9a-f]{32})\.md$/;

export type Action =
  | { kind: "write"; id: string; absPath: string; content: string }
  | { kind: "move"; id: string; from: string; to: string; content: string }
  | { kind: "delete"; id: string; absPath: string };

export type ManifestSummary = {
  written: number;
  moved: number;
  deleted: number;
  unchanged: number;
};

/**
 * Glob all <pageId>.md files under docsRoot and return a Map<pageId, absolutePath>.
 */
export async function globExistingFiles(
  docsRoot: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for await (const entry of glob("**/[0-9a-f]*.md", { cwd: docsRoot })) {
      const abs = join(docsRoot, entry);
      const m = `/${entry}`.match(PAGEID_FILENAME_RE);
      if (!m) continue;
      const id = m[1];
      if (id.length !== 32) continue;
      map.set(id, abs);
    }
  } catch (err) {
    // If docsRoot doesn't exist yet, just return empty map.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return map;
}

/**
 * Compare desired vs existing, produce action list.
 *
 * `desired` is keyed by pageId; the content for each is fetched at action time.
 * `contents` maps pageId → file body (already-rendered frontmatter + markdown).
 */
export function planActions(
  desired: Map<string, PathInfo>,
  existing: Map<string, string>,
  contents: Map<string, string>,
  docsRoot: string,
): Action[] {
  const actions: Action[] = [];

  for (const [id, info] of desired) {
    const desiredAbs = join(docsRoot, info.relPath);
    const oldAbs = existing.get(id);
    const content = contents.get(id);
    if (content === undefined) {
      throw new Error(`planActions: missing content for ${id}`);
    }
    if (!oldAbs) {
      actions.push({ kind: "write", id, absPath: desiredAbs, content });
    } else if (oldAbs !== desiredAbs) {
      actions.push({
        kind: "move",
        id,
        from: oldAbs,
        to: desiredAbs,
        content,
      });
    } else {
      // Same path — caller can compare content to decide if a write is needed.
      actions.push({ kind: "write", id, absPath: desiredAbs, content });
    }
  }

  for (const [id, oldAbs] of existing) {
    if (!desired.has(id)) {
      actions.push({ kind: "delete", id, absPath: oldAbs });
    }
  }

  return actions;
}

/**
 * Apply the planned actions to the filesystem, idempotently:
 *   - Write: skip if file content matches; mkdir -p; writeFile
 *   - Move: rename, then write new content
 *   - Delete: rm
 *
 * Also removes empty directories left behind by moves/deletes.
 */
export async function applyActions(
  actions: Action[],
  docsRoot: string,
): Promise<ManifestSummary> {
  const summary: ManifestSummary = {
    written: 0,
    moved: 0,
    deleted: 0,
    unchanged: 0,
  };

  // Collect dirs that may need cleanup after moves/deletes.
  const dirsToCheck = new Set<string>();

  for (const action of actions) {
    switch (action.kind) {
      case "write": {
        await mkdir(dirname(action.absPath), { recursive: true });
        let existing: string | null = null;
        try {
          existing = await readFile(action.absPath, "utf8");
        } catch {
          // file doesn't exist — that's fine, we'll write
        }
        if (existing === action.content) {
          summary.unchanged += 1;
        } else {
          await writeFile(action.absPath, action.content, "utf8");
          summary.written += 1;
        }
        break;
      }
      case "move": {
        await mkdir(dirname(action.to), { recursive: true });
        // rename is atomic on POSIX; if `to` exists, rename overwrites
        await rename(action.from, action.to);
        await writeFile(action.to, action.content, "utf8");
        dirsToCheck.add(dirname(action.from));
        summary.moved += 1;
        break;
      }
      case "delete": {
        await rm(action.absPath, { force: true });
        dirsToCheck.add(dirname(action.absPath));
        summary.deleted += 1;
        break;
      }
    }
  }

  // Clean up empty dirs left behind by moves/deletes.
  for (const dir of dirsToCheck) {
    try {
      await rm(dir, { recursive: false }); // fails if non-empty
    } catch {
      // dir still has files — leave it alone
    }
  }

  // Log moves so editors can see URL changes coming.
  for (const action of actions) {
    if (action.kind === "move") {
      log(
        `moved: ${relative(docsRoot, action.from)} → ${relative(docsRoot, action.to)}`,
      );
    }
  }
  if (summary.deleted > 0) {
    warn(`deleted ${summary.deleted} file(s) for archived pages`);
  }

  return summary;
}
