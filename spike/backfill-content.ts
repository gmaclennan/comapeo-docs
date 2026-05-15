/**
 * Backfill content from source pages into the new tree structure.
 *
 * Prereq: the new tree's root page MUST be shared with the local Notion
 * integration "Gregor Local Testing" via Notion's UI:
 *   1. Open the root page (https://www.notion.so/360c90f22b6381b5a108c49dfb1ff9af)
 *   2. Click ⋯ → Connect to → "Gregor Local Testing"
 *   3. Confirm "give access to all sub-pages"
 *
 * Then run this script. For each article in tree-mapping.json:
 *   - Read the new article's current placeholder content (one line)
 *   - Read the full source markdown from the source DB
 *   - Sanitize (strip <unknown>, <table_of_contents>, unwrap <synced_block>)
 *   - Rewrite cross-page links: replace any source notion.so URLs with the new page IDs
 *   - Replace the placeholder content with the rewritten markdown
 *
 * Idempotent: safe to re-run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { fetchPageMarkdown } from "./lib/notion-fetch";
import { replacePageMarkdown } from "./lib/notion-write";

const OUTPUT = join(import.meta.dir ?? __dirname, "output");
const limit = pLimit(2);

type TreeMapping = {
  rootId: string;
  sections: Array<{
    title: string;
    id: string;
    articles: Array<{ title: string; newId: string; sourceId: string }>;
  }>;
};

function sanitize(md: string): string {
  let out = md;
  out = out.replace(/<unknown\b[^>]*\/>/g, "");
  out = out.replace(/<unknown\b[^>]*>[\s\S]*?<\/unknown>/g, "");
  out = out.replace(/<table_of_contents\b[^>]*\/>/g, "");
  out = out.replace(
    /<synced_block(?:_reference)?\b[^>]*>([\s\S]*?)<\/synced_block(?:_reference)?>/g,
    (_, inner) => inner.trim()
  );
  out = out.replace(/!\[[^\]]*\]\(file:\/\/[^)]*\)/g, "_[image not migrated — re-upload in Notion]_");
  out = out.replace(/<span\s+discussion-urls="[^"]*"[^>]*>([\s\S]*?)<\/span>/g, "$1");
  out = out.replace(/\n{4,}/g, "\n\n\n");
  return out.trim();
}

function buildLinkMap(mapping: TreeMapping): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of mapping.sections) {
    for (const a of s.articles) {
      m.set(a.sourceId, a.newId);
    }
    m.set(s.id, s.id);
  }
  return m;
}

function rewriteLinks(md: string, linkMap: Map<string, string>): string {
  let out = md;
  out = out.replace(
    /(\[[^\]]*\]\()(https?:\/\/(?:www\.)?notion\.so\/(?:[^\/]+\/)?)([0-9a-f]{32})([^)]*\))/gi,
    (_full, pre, _host, id, post) => {
      const newId = linkMap.get(id);
      if (!newId) return _full;
      return `${pre}https://www.notion.so/${newId}${post}`;
    }
  );
  out = out.replace(
    /<mention-page url="https?:\/\/(?:www\.)?notion\.so\/([0-9a-f]{32})"\s*\/>/g,
    (_full, id) => {
      const newId = linkMap.get(id);
      if (!newId) return _full;
      return `<mention-page url="https://www.notion.so/${newId}"/>`;
    }
  );
  return out;
}

async function backfillOne(
  article: { title: string; newId: string; sourceId: string },
  linkMap: Map<string, string>
): Promise<{ ok: true; chars: number } | { ok: false; error: string }> {
  try {
    const sourceRaw = (await fetchPageMarkdown(article.sourceId)).markdown;
    const cleaned = rewriteLinks(sanitize(sourceRaw), linkMap);

    if (!cleaned) {
      return { ok: false, error: "source page produced empty content after sanitize" };
    }

    await replacePageMarkdown(article.newId, cleaned);
    return { ok: true, chars: cleaned.length };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

async function main() {
  const mapping = JSON.parse(readFileSync(join(OUTPUT, "tree-mapping.json"), "utf8")) as TreeMapping;
  const linkMap = buildLinkMap(mapping);

  const articles = mapping.sections.flatMap((s) =>
    s.articles.map((a) => ({ ...a, section: s.title }))
  );

  console.log(`Backfilling ${articles.length} articles (concurrency 2)...\n`);
  const start = performance.now();
  let ok = 0;
  let failed = 0;

  await Promise.all(
    articles.map((a) =>
      limit(async () => {
        const result = await backfillOne(a, linkMap);
        if (result.ok) {
          ok++;
          console.log(`  ✓ ${a.section} / ${a.title} (${result.chars} chars)`);
        } else {
          failed++;
          console.log(`  ✗ ${a.section} / ${a.title} → ${result.error.slice(0, 200)}`);
        }
      })
    )
  );

  console.log(`\nDone in ${((performance.now() - start) / 1000).toFixed(1)}s. Success: ${ok}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
