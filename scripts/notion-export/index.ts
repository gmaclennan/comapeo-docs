// Pipeline orchestrator.
// Sprint A: stub. Sprint B implements the full walk → transform → write → category → redirects → validate flow.
//
// For now, this entry point exists so `pnpm notion:export` is wired up
// and points to the right place. To smoke-test the tree walker, use
// `pnpm notion:walk` instead.

import { fileURLToPath } from "node:url";
import { log } from "./logger.ts";

async function main(): Promise<void> {
  log("scripts/notion-export/index.ts is a Sprint A stub.");
  log("");
  log("To smoke-test the tree walker against your Notion workspace:");
  log("  pnpm notion:walk                                  # uses NOTION_ROOT_PAGE_ID from .env");
  log("  pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af # explicit root id");
  log("");
  log("Sprint B will implement the full pipeline here.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error("[notion-export]", err);
    process.exit(1);
  }
}
