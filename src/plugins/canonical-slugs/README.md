# canonical-slugs

Build-time URL slug injection for Docusaurus docs. Wires per-locale
`slug: /<section-slug>-<sectionPageId>/.../<page-slug>-<pageId>` into each
doc's frontmatter before the docs plugin resolves routes.

## How it works

Two pieces, working together:

1. **Pipeline manifest.** `scripts/notion-export/manifest.ts` writes
   `.canonical-slugs.json` at the repo root after a successful sync. It
   contains structural metadata for every page in the Notion tree
   (`id`, `title`, `parentId`, `ancestorIds`, `isSection`, `isRoot`).
2. **`parseFrontMatter` hook.** `parse-frontmatter.ts` is wired into
   `docusaurus.config.ts` as `markdown.parseFrontMatter`. For each `.md`
   file Docusaurus loads, it default-parses the frontmatter, extracts the
   pageId from the filename, looks up the page in the manifest, computes
   the canonical slug, and returns the frontmatter with `slug:` injected.

The result: source files stay minimal (`title:` only), but Docusaurus
sees `slug: /getting-started-<sectionId>/install-<pageId>` and routes
accordingly.

## URL pattern

Per `.claude/skills/notion-markdown-export/tree-publish-plan.md` §3:

```
Root                 → /
Anything else        → /<a1-slug>-<a1-id>/.../<this-slug>-<this-id>
```

Every non-root URL component carries its `-<pageId>` suffix. PageIds are
stable across locales; only slug prefixes translate.

## Files

```
parse-frontmatter.ts   parseFrontMatter hook — the entry point used by docusaurus.config.ts
compute-slug.ts        Pure slug-from-manifest computation
compute-slug.test.ts   Unit tests for compute-slug (10 tests)
```

## Locale handling

For Sprint C (EN only): the manifest's `title` field is used for every
page in every locale. Output URLs use EN slugs everywhere — Spanish
content lives at the same URL as English content, just under `/es/`.

For Phase 4.5 (Weblate translations): the hook reads the localized
title from the current file's own frontmatter and uses that for the
final URL segment. Ancestor titles will need to come from per-locale
title maps; the current implementation uses manifest (EN) titles as
ancestor fallbacks. Extending to read all i18n/`<locale>`/ files at
plugin load time is the natural Sprint 4.5 follow-up.

## Manifest absence

If `.canonical-slugs.json` is missing (e.g., `pnpm dev` on a fresh
checkout before the first `pnpm notion:export`), the hook silently
skips slug injection. Docusaurus falls back to path-based routes and
the dev server still boots.
