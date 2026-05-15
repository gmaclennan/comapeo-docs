import { fileURLToPath } from "node:url";
import {
  extractIconString,
  extractTitle,
  fetchPageMarkdown,
  fetchPageMeta,
  normalizePageId,
} from "./fetch.ts";
import { NOTION_ROOT_PAGE_ID } from "./env.ts";
import { debug, log, warn } from "./logger.ts";
import { extractChildIds, extractMentionIds } from "./parse.ts";

export type TreeNode = {
  id: string;
  title: string;
  icon: string | null;
  ready: boolean;
  parentId: string | null;
  position: number;
  depth: number;
  children: TreeNode[];
  mentionIds: string[];
  markdown: string;
  lastEditedTime: string;
  truncated: boolean;
  unknownBlockIds: string[];
};

type FetchedPage = {
  meta: Awaited<ReturnType<typeof fetchPageMeta>>;
  markdown: Awaited<ReturnType<typeof fetchPageMarkdown>>;
};

async function fetchPage(pageId: string): Promise<FetchedPage> {
  const [meta, markdown] = await Promise.all([
    fetchPageMeta(pageId),
    fetchPageMarkdown(pageId),
  ]);
  return { meta, markdown };
}

async function walkInto(
  pageId: string,
  parentId: string | null,
  position: number,
  depth: number,
  visited: Set<string>,
): Promise<TreeNode> {
  const id = normalizePageId(pageId);

  if (visited.has(id)) {
    warn(
      `cycle detected at ${id} (depth ${depth}); skipping recursion to avoid infinite walk`,
    );
    return {
      id,
      title: "(cycle)",
      icon: null,
      ready: false,
      parentId,
      position,
      depth,
      children: [],
      mentionIds: [],
      markdown: "",
      lastEditedTime: "",
      truncated: false,
      unknownBlockIds: [],
    };
  }
  visited.add(id);

  debug(`fetching ${id} (depth ${depth})`);
  const { meta, markdown } = await fetchPage(id);

  const title = extractTitle(meta);
  const icon = extractIconString(meta);
  const ready = icon === "✅";
  const childIds = extractChildIds(markdown.markdown);
  const mentionIds = extractMentionIds(markdown.markdown);

  const children: TreeNode[] = [];
  for (let i = 0; i < childIds.length; i++) {
    const child = await walkInto(childIds[i], id, i, depth + 1, visited);
    children.push(child);
  }

  return {
    id,
    title,
    icon,
    ready,
    parentId,
    position,
    depth,
    children,
    mentionIds,
    markdown: markdown.markdown,
    lastEditedTime: meta.last_edited_time,
    truncated: markdown.truncated,
    unknownBlockIds: markdown.unknown_block_ids,
  };
}

export async function walkTree(rootId: string): Promise<TreeNode> {
  return walkInto(rootId, null, 0, 0, new Set());
}

export function flattenTree(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [node];
  for (const child of node.children) {
    out.push(...flattenTree(child));
  }
  return out;
}

function printSummary(root: TreeNode): void {
  const all = flattenTree(root);
  const ready = all.filter((n) => n.ready).length;
  const truncated = all.filter((n) => n.truncated).length;
  const unknown = all.reduce(
    (acc, n) => acc + n.unknownBlockIds.length,
    0,
  );

  log("");
  log(`=== TREE SUMMARY ===`);
  log(`Total pages: ${all.length}`);
  log(`Ready to publish (✅): ${ready}`);
  log(`Drafts (🚧 or other icon): ${all.length - ready}`);
  log(`Truncated pages: ${truncated}`);
  log(`Unknown blocks (total): ${unknown}`);
  log("");

  log(`=== TREE STRUCTURE ===`);
  function printNode(node: TreeNode): void {
    const indent = "  ".repeat(node.depth);
    const status = node.ready ? "✅" : node.icon ?? "🚧";
    log(`${indent}${status} ${node.title || "(untitled)"} [${node.id}]`);
    for (const child of node.children) printNode(child);
  }
  printNode(root);

  const withMentions = all.filter((n) => n.mentionIds.length > 0);
  if (withMentions.length > 0) {
    log("");
    log(`=== CROSS-PAGE LINKS (mention-page) ===`);
    const ids = new Set(all.map((n) => n.id));
    for (const node of withMentions) {
      log(`From "${node.title}" (${node.id}):`);
      for (const mid of node.mentionIds) {
        const inside = ids.has(mid);
        log(`  → ${mid} ${inside ? "(in tree)" : "(EXTERNAL — outside tree)"}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const argId = process.argv[2];
  const rootId = argId ?? NOTION_ROOT_PAGE_ID;

  if (!rootId) {
    console.error(
      "[notion-export] no root page id. Pass one as argv[2], or set NOTION_ROOT_PAGE_ID in .env",
    );
    process.exit(1);
  }

  if (!argId) {
    log(`No page id passed; using NOTION_ROOT_PAGE_ID=${rootId} from .env`);
  }

  log(`Walking tree from ${rootId}...`);
  const start = performance.now();
  const root = await walkTree(rootId);
  const ms = performance.now() - start;

  const all = flattenTree(root);
  log(
    `Walked ${all.length} pages in ${ms.toFixed(0)}ms (avg ${(ms / all.length).toFixed(0)}ms/page)`,
  );

  printSummary(root);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error("[notion-export] walk failed:", err);
    process.exit(1);
  }
}
