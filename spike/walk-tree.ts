/**
 * Tree-walking spike: starting at a root page ID, fetch each page's Markdown
 * via the Markdown Content API and discover children by:
 *   1. Looking for `<page url="..."/>` blocks in the parent's markdown output
 *      (these are emitted when a page has child pages)
 *   2. Recursing into each discovered child
 *
 * This validates whether a page-tree structure can replace the current
 * database-driven pipeline, and what cross-page links / publish-status
 * markers actually look like in the output.
 *
 * Usage:
 *   bun spike/walk-tree.ts <root-page-id>
 */
import { fetchPageMarkdown } from "./lib/notion-fetch";
import { NOTION_API_KEY, NOTION_VERSION } from "./lib/env";

const PAGE_TAG_RE = /<page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"(?:\s+color="[^"]*")?>([^<]*)<\/page>/g;
const SELF_CLOSING_PAGE_RE = /<page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"\s*\/>/g;
const MENTION_PAGE_RE = /<mention-page url="https:\/\/www\.notion\.so\/([0-9a-f]{32})"\s*\/>/g;

type Node = {
  id: string;
  title: string;
  icon: string | null;
  ready: boolean;
  childIds: string[];
  mentionIds: string[];
  rawMarkdown: string;
  truncated: boolean;
  unknownBlocks: number;
};

const tree: Map<string, Node> = new Map();

async function fetchPageMeta(pageId: string): Promise<{ title: string; icon: string | null }> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (!res.ok) throw new Error(`page ${pageId}: ${res.status} ${await res.text()}`);
  const page = (await res.json()) as { icon: any; properties: any };

  const titleProp = Object.values(page.properties).find(
    (p: any) => p?.type === "title"
  ) as any;
  const title = titleProp?.title?.map((t: any) => t.plain_text).join("") ?? "";

  let icon: string | null = null;
  if (page.icon) {
    if (page.icon.type === "emoji") icon = page.icon.emoji;
    else if (page.icon.type === "external") icon = `external:${page.icon.external.url}`;
    else if (page.icon.type === "custom_emoji") icon = `custom:${page.icon.custom_emoji.name}`;
  }
  return { title, icon };
}

async function walk(pageId: string, depth = 0) {
  if (tree.has(pageId)) return;

  const indent = "  ".repeat(depth);
  console.log(`${indent}fetching ${pageId}...`);

  const [meta, mdRes] = await Promise.all([
    fetchPageMeta(pageId),
    fetchPageMarkdown(pageId),
  ]);

  const childIds = new Set<string>();
  const mentionIds = new Set<string>();

  for (const m of mdRes.markdown.matchAll(PAGE_TAG_RE)) childIds.add(m[1]);
  for (const m of mdRes.markdown.matchAll(SELF_CLOSING_PAGE_RE)) childIds.add(m[1]);
  for (const m of mdRes.markdown.matchAll(MENTION_PAGE_RE)) mentionIds.add(m[1]);

  const ready = meta.icon === "✅";

  const node: Node = {
    id: pageId,
    title: meta.title,
    icon: meta.icon,
    ready,
    childIds: [...childIds],
    mentionIds: [...mentionIds],
    rawMarkdown: mdRes.markdown,
    truncated: mdRes.truncated,
    unknownBlocks: mdRes.unknown_block_ids.length,
  };
  tree.set(pageId, node);

  console.log(
    `${indent}  → "${meta.title}" icon=${meta.icon ?? "none"} ready=${ready} children=${childIds.size} mentions=${mentionIds.size} truncated=${mdRes.truncated}`
  );

  for (const childId of childIds) {
    await walk(childId, depth + 1);
  }
}

async function main() {
  const rootId = process.argv[2];
  if (!rootId) {
    console.error("Usage: bun spike/walk-tree.ts <root-page-id>");
    process.exit(1);
  }

  console.log(`Walking tree from root ${rootId}\n`);
  const start = performance.now();
  await walk(rootId.replace(/-/g, ""));
  const ms = performance.now() - start;

  console.log(`\n=== TREE SUMMARY ===\n`);
  console.log(`Total pages: ${tree.size}`);
  console.log(`Total time: ${ms.toFixed(0)}ms (avg ${(ms / tree.size).toFixed(0)}ms/page)`);

  console.log(`\n=== READY-TO-PUBLISH FILTER ===\n`);
  for (const node of tree.values()) {
    const status = node.ready ? "✅ PUBLISH" : "🚧 SKIP   ";
    console.log(`${status}  ${node.title}  (${node.id})`);
  }

  console.log(`\n=== CROSS-PAGE LINKS (mention-page) ===\n`);
  for (const node of tree.values()) {
    if (node.mentionIds.length === 0) continue;
    console.log(`From "${node.title}":`);
    for (const mid of node.mentionIds) {
      const target = tree.get(mid);
      console.log(`  → ${mid} = ${target ? `"${target.title}"` : "UNKNOWN (outside tree)"}`);
    }
  }

  console.log(`\n=== RAW MARKDOWN PER PAGE ===\n`);
  for (const node of tree.values()) {
    console.log(`\n--- ${node.title} (${node.id}) ---`);
    console.log(node.rawMarkdown);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
