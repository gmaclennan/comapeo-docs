# scripts/notion-export

Offline pipeline that fetches the CoMapeo docs page tree from Notion, transforms output for Docusaurus, and writes Markdown into `docs/` plus images into `static/images/notion/`.

Not part of `docusaurus build`. Runs separately, commits its output, then Docusaurus builds from those committed files.

## Commands

```bash
pnpm notion:walk                                         # smoke-test: walk and print the tree
pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af        # explicit root id
pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af --verbose
pnpm notion:export                                       # full pipeline: walk → transform → write
pnpm test scripts/notion-export                          # vitest
```

`pnpm notion:export` is idempotent: rerunning with no Notion changes produces zero git diff.

## Files

```
env.ts            lazy env getters (NOTION_API_KEY required, NOTION_ROOT_PAGE_ID + NOTION_VERSION optional). Node loads .env via `--env-file-if-exists=.env` in the pnpm scripts; no `dotenv` runtime dep.
fetch.ts          Notion API client via fetch-extras (rate limit 3 rps, retry 429/5xx)
parse.ts          pure regex helpers for <page> / <mention-page> tag IDs
walk-tree.ts      walkNotionTree() returns Map<pageId, Page>; CLI when invoked directly
paths.ts          mutates Pages with relPath + dirSegments from ancestor chain
transform.ts      Notion markdown → Docusaurus markdown via node-html-parser (HTML tags) + regex (inline)
images.ts         ImageStore interface + LocalImageStore; processImagesInMarkdown returns ImageWork
frontmatter.ts    emit minimal `title:` YAML
category-json.ts  _category_.json per section dir; doc-id derived from page.relPath
write-files.ts    glob, diff vs Pages map, write/move/delete in one inline pass
index.ts          orchestrator: walkNotionTree → computePagePaths → renderPages → syncFilesystem → writeCategoryConfig
logger.ts         tiny `[notion-export]` prefixed logger; --verbose / VERBOSE for debug
```

## Pipeline shape

```
walkNotionTree(options)                          Pages built from Notion
computePagePaths(pages)                          adds relPath, dirSegments
renderPages(pages, options)                      adds body for ✅ pages; downloads images
syncFilesystem(pages, options)                   writes/moves/deletes files in docs/
writeCategoryConfig(pages, options)              writes _category_.json per section
```

Each step takes `(pages, options)` and mutates `pages` in place — the central-state pattern. No parallel maps; no accumulator side channels.

## Architecture references

- [tree-publish-plan.md](../../.claude/skills/notion-markdown-export/tree-publish-plan.md) — page tree, URLs, slugs, redirects, two-branch publish
- [transforms-plan.md](../../.claude/skills/notion-markdown-export/transforms-plan.md) — HTML / callout / image transforms
- [translations-plan.md](../../.claude/skills/notion-markdown-export/translations-plan.md) — Weblate integration (Phase 4.5; not yet built)
- [SKILL.md](../../.claude/skills/notion-markdown-export/SKILL.md) — Notion Markdown Content API reference

Active sprint plan: `/Users/gregor/.claude/plans/parsed-skipping-badger.md`.

## Toolchain

Node 24+ (native TypeScript execution), pnpm. The `package.json` in this directory has `"type": "module"` so files run as ESM; the repo root stays CJS for Docusaurus's SSR bundle.
