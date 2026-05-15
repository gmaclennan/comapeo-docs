// Walks a Notion page tree via the Markdown Content API and returns a flat
// Map<pageId, Page>. Each Page carries:
//   - Identity (id, parentId, ancestorIds, childIds, depth, position)
//   - Notion metadata (title, icon, ready, lastEditedTime)
//   - Raw markdown from the API
//
// Later pipeline steps mutate the same Page objects to add `relPath`,
// `dirSegments`, and `body`. The orchestrator threads one map through
// every step instead of maintaining parallel maps.

import { fileURLToPath } from "node:url";
import {
  extractIconString,
  extractTitle,
  fetchPageMarkdown,
  fetchPageMeta,
  normalizePageId,
} from "./fetch.ts";
import { NOTION_ROOT_PAGE_ID } from "./env.ts";
import { debug, error, log, warn } from "./logger.ts";
import { extractChildIds, extractMentionIds } from "./parse.ts";

export type Page = {
  // === walk-time identity ===
  id: string;
  parentId: string | null;
  /** pageIds from root → … → immediate parent. Empty for root. */
  ancestorIds: string[];
  /** pageIds of children in Notion sidebar order. */
  childIds: string[];
  /** 0 for root, increments at each level. */
  depth: number;
  /** Index among siblings (0-based). */
  position: number;

  // === walk-time content ===
  title: string;
  icon: string | null;
  /** Icon === "✅". Drives whether a file is written. */
  ready: boolean;
  lastEditedTime: string;
  /** Raw markdown from /v1/pages/:id/markdown. */
  markdown: string;
  truncated: boolean;
  unknownBlockIds: string[];
  /** Cross-page references (<mention-page url=.../>) — for the lint report. */
  mentionIds: string[];

  // === filled by computePagePaths ===
  /** "section-slug/<pageId>.md", relative to docs/. */
  relPath?: string;
  /** ["section-slug"]. Empty for root + top-level leaves. */
  dirSegments?: string[];

  // === filled by renderPages (✅ only) ===
  /** Final file body: frontmatter + transformed markdown. */
  body?: string;
};

export type Pages = Map<string, Page>;

export type WalkOptions = {
  /** 32-hex pageId (no dashes) or a raw Notion URL with the id at the end. */
  rootId: string;
};

export async function walkNotionTree(options: WalkOptions): Promise<Pages> {
  const pages: Pages = new Map();
  await walkInto({
    pageId: options.rootId,
    parentId: null,
    ancestorIds: [],
    position: 0,
    depth: 0,
    pages,
  });
  return pages;
}

type WalkInto = {
  pageId: string;
  parentId: string | null;
  ancestorIds: string[];
  position: number;
  depth: number;
  pages: Pages;
};

async function walkInto(args: WalkInto): Promise<void> {
  const id = normalizePageId(args.pageId);

  if (args.pages.has(id)) {
    warn(
      `cycle detected at ${id} (depth ${args.depth}); not recursing again`,
    );
    return;
  }

  debug(`fetching ${id} (depth ${args.depth})`);
  const [meta, mdRes] = await Promise.all([
    fetchPageMeta(id),
    fetchPageMarkdown(id),
  ]);

  const title = extractTitle(meta);
  const icon = extractIconString(meta);
  const ready = icon === "✅";
  const childIds = extractChildIds(mdRes.markdown);
  const mentionIds = extractMentionIds(mdRes.markdown);

  // Insert this page BEFORE recursing so child pages can look up their parent.
  args.pages.set(id, {
    id,
    parentId: args.parentId,
    ancestorIds: args.ancestorIds,
    childIds,
    depth: args.depth,
    position: args.position,
    title,
    icon,
    ready,
    lastEditedTime: meta.last_edited_time,
    markdown: mdRes.markdown,
    truncated: mdRes.truncated,
    unknownBlockIds: mdRes.unknown_block_ids,
    mentionIds,
  });

  for (let i = 0; i < childIds.length; i++) {
    await walkInto({
      pageId: childIds[i],
      parentId: id,
      ancestorIds: [...args.ancestorIds, id],
      position: i,
      depth: args.depth + 1,
      pages: args.pages,
    });
  }
}

// === CLI entry ==========================================================

function printWalkSummary(pages: Pages): void {
  const all = [...pages.values()];
  const ready = all.filter((p) => p.ready).length;
  const truncated = all.filter((p) => p.truncated).length;
  const unknown = all.reduce((acc, p) => acc + p.unknownBlockIds.length, 0);

  log("");
  log(`=== TREE SUMMARY ===`);
  log(`Total pages: ${all.length}`);
  log(`Ready to publish (✅): ${ready}`);
  log(`Drafts (🚧 or other icon): ${all.length - ready}`);
  log(`Truncated pages: ${truncated}`);
  log(`Unknown blocks (total): ${unknown}`);
  log("");

  log(`=== TREE STRUCTURE ===`);
  const inOrder = [...pages.values()].sort(
    (a, b) =>
      a.depth - b.depth ||
      a.ancestorIds.length - b.ancestorIds.length ||
      a.position - b.position,
  );
  // Recurse for readable printing.
  const root = inOrder.find((p) => p.parentId === null);
  if (root) printTree(pages, root);

  const withMentions = all.filter((p) => p.mentionIds.length > 0);
  if (withMentions.length > 0) {
    log("");
    log(`=== CROSS-PAGE LINKS (mention-page) ===`);
    const ids = new Set(all.map((p) => p.id));
    for (const page of withMentions) {
      log(`From "${page.title}" (${page.id}):`);
      for (const mid of page.mentionIds) {
        const inside = ids.has(mid);
        log(
          `  → ${mid} ${inside ? "(in tree)" : "(EXTERNAL — outside tree)"}`,
        );
      }
    }
  }
}

function printTree(pages: Pages, page: Page): void {
  const indent = "  ".repeat(page.depth);
  const status = page.ready ? "✅" : page.icon ?? "🚧";
  log(`${indent}${status} ${page.title || "(untitled)"} [${page.id}]`);
  for (const childId of page.childIds) {
    const child = pages.get(childId);
    if (child) printTree(pages, child);
  }
}

async function main(): Promise<void> {
  const argId = process.argv[2];
  const rootId = argId ?? NOTION_ROOT_PAGE_ID;
  if (!rootId) {
    error(
      "no root page id. Pass one as argv[2] or set NOTION_ROOT_PAGE_ID in .env",
    );
    process.exit(1);
  }
  if (!argId) {
    log(`No page id passed; using NOTION_ROOT_PAGE_ID=${rootId} from .env`);
  }

  log(`Walking tree from ${rootId}...`);
  const start = performance.now();
  const pages = await walkNotionTree({ rootId });
  const ms = performance.now() - start;

  log(
    `Walked ${pages.size} pages in ${ms.toFixed(0)}ms (avg ${(ms / pages.size).toFixed(0)}ms/page)`,
  );

  printWalkSummary(pages);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
}
