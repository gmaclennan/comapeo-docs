# scripts/notion-export

Offline pipeline that fetches the CoMapeo docs page tree from Notion, transforms the output for Docusaurus, and writes Markdown files into `docs/` (plus images into `static/images/notion/` and Cloudflare `_redirects`).

Not part of the Docusaurus build. Runs separately, commits its output, then Docusaurus builds from those committed files.

## When this is mature (Sprint B+)

```bash
pnpm notion:export   # walk Notion → write docs/, static/images/, static/_redirects
```

## Sprint A (current state)

Only the tree walker is wired up. The orchestrator entry (`index.ts`) is a stub.

```bash
pnpm notion:walk                                       # uses NOTION_ROOT_PAGE_ID from .env
pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af      # explicit root
pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af --verbose
```

## Files

```
env.ts            env loading (NOTION_API_KEY required, NOTION_ROOT_PAGE_ID + NOTION_VERSION optional)
fetch.ts          Notion API client (fetch-extras pipeline: rate-limit 3 rps, retry 429/5xx, http-error)
parse.ts          pure regex helpers for extracting page ids from Notion markdown
walk-tree.ts      walkTree() recursive walker; CLI main when invoked directly
transform.ts      Notion → Docusaurus markdown transforms (Sprint A: callouts only)
logger.ts         tiny [notion-export] prefixed logger with --verbose support
index.ts          orchestrator entry (Sprint A stub; populated in Sprint B)
```

## Architecture references

For background on why the pipeline is shaped this way, read in order:

- [tree-publish-plan.md](../../.claude/skills/notion-markdown-export/tree-publish-plan.md) — page tree, URLs, slugs, redirects, two-branch publish
- [transforms-plan.md](../../.claude/skills/notion-markdown-export/transforms-plan.md) — HTML / callout / image transforms
- [SKILL.md](../../.claude/skills/notion-markdown-export/SKILL.md) — Notion Markdown Content API reference + Enhanced Markdown quirks

Active sprint plan: `/Users/gregor/.claude/plans/parsed-skipping-badger.md`.

## Toolchain

Node 24+ (native TypeScript), pnpm. `.ts` files run directly via `node`. No build step.

## Testing

```bash
pnpm test scripts/notion-export
```

The `*.test.ts` files use vitest and only import from `parse.ts` / `transform.ts` (pure modules without env dependencies), so tests run without `.env` setup.
