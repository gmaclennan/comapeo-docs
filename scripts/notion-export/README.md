# scripts/notion-export

Offline pipeline that fetches the CoMapeo docs page tree from Notion, transforms output for Docusaurus, and writes Markdown into `docs/` plus images into `static/images/notion/`.

Not part of `docusaurus build`. Runs separately, commits its output, then Docusaurus builds from those committed files.

## Commands

```bash
pnpm notion:walk                                         # smoke-test: walk and print the tree
pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af        # explicit root id
pnpm notion:walk 360c90f22b6381b5a108c49dfb1ff9af --verbose
pnpm notion:export                                       # full pipeline: walk → transform → write
pnpm notion:export:dry-run                               # preview what would change (no repo writes for docs/redirects/manifest)
pnpm lint:content                                        # scan docs/ for visible-failure markers (exit 1 if any)
pnpm test scripts/notion-export                          # vitest
```

`pnpm notion:export` is idempotent: rerunning with no Notion changes produces zero git diff.

## Failure handling

The pipeline never exits non-zero on content-quality issues. Instead it writes **visible markers** into the affected page so reviewers can see them on the staging Cloudflare preview:

| Failure | Marker emitted |
|---|---|
| Broken cross-page link (`[text](pageId.md)` where target isn't a published page) | `<span data-notion-lint="broken-link" data-target="..." data-reason="...">⚠️ broken link</span>` |
| Image fetch failure / unresolved `file://` / bare-filename ref | `<div data-notion-lint="missing-image" data-url="..." data-category="...">⚠️ Missing image</div>` |
| Page truncated by the Notion API (only when `unknown_block_ids` is empty — see below) | `<div data-notion-lint="truncated">⚠️ Truncated by Notion API …</div>` |

Truncation is only flagged when `unknown_block_ids.length === 0`. Notion sets `truncated: true` whenever any block was unrenderable (and `STRIP_TAGS` in `transform.ts` drops those anyway — they're usually editorial controls like buttons). Genuine content loss is the truncated-without-unknown-blocks case.

The lint workflow (`.github/workflows/lint-content.yml`) greps for `data-notion-lint=` on the `staging → published` promotion PR and fails the check if any markers are present. The remark plugin at `src/plugins/notion-lint/` strips the markers in production builds so a marker that slips past lint (e.g. an admin overriding branch protection) doesn't ship to the deployed site.

Structural failures (env missing, sibling-section slug collisions, multiple roots, Notion API exhausted retries) still hard-fail with `process.exit(1)` — those produce un-buildable output.

## Files

```
env.ts            lazy env getters (NOTION_API_KEY required, NOTION_ROOT_PAGE_ID + NOTION_VERSION optional). Node loads .env via `--env-file-if-exists=.env` in the pnpm scripts; no `dotenv` runtime dep.
fetch.ts          Notion API client via fetch-extras (rate limit 3 rps, retry 429/5xx)
parse.ts          pure regex helpers for <page> / <mention-page> tag IDs
walk-tree.ts      walkNotionTree() returns Map<pageId, Page>; CLI when invoked directly
paths.ts          mutates Pages with relPath from ancestor chain
transform.ts      Notion markdown → Docusaurus markdown via node-html-parser (HTML tags) + regex (inline)
image-store.ts    ImageStore interface + LocalImageStore + makeImageStore factory (R2 swap-in point)
images.ts         processImagesInMarkdown: extract → classify → download → rewrite; warns per failed/lint URL and writes `data-notion-lint="missing-image"` markers in place
frontmatter.ts    emit minimal `title:` YAML
category-json.ts  _category_.json per section dir; doc-id derived from page.relPath
write-files.ts    glob, diff vs Pages map, write/move/delete in one inline pass
validate.ts       markBrokenLinks: detects + rewrites cross-page broken links to `data-notion-lint="broken-link"` spans in one pass; returns count
lint.ts           pure marker-counting + CLI for `pnpm lint:content`
index.ts          orchestrator: walkNotionTree → computePagePaths → renderPages → markTruncated → markBrokenLinks → syncFilesystem → writeCategoryConfig → manifest → redirects
logger.ts         tiny `[notion-export]` prefixed logger; --verbose / VERBOSE for debug
```

## Pipeline shape

```
walkNotionTree(options)                          Pages built from Notion
computePagePaths(pages)                          adds relPath
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
