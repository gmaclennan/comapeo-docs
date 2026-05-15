# Contributing to CoMapeo Docs

This site is built with [Docusaurus](https://docusaurus.io/). The English
content is authored in **Notion** and exported to Markdown by a small
pipeline in this repo. Translations (planned) will come from Crowdin.

This file covers the parts of the workflow that aren't obvious from the
code. For deeper architecture detail see
[`.claude/skills/notion-markdown-export/`](.claude/skills/notion-markdown-export/).

## Where content lives

```
Notion page tree (English source)
        ↓ pnpm notion:export
docs/<section>/<pageId>.md      ← committed to this repo
static/_redirects               ← bare-ID and rename redirects
static/redirect-history.json    ← ledger of every URL each page has ever had
        ↓ pnpm build → Cloudflare Pages
https://docs.comapeo.app
```

The Notion root page id is in `.env` as `NOTION_ROOT_PAGE_ID`. The pipeline
walks the full sub-tree from that root and writes Markdown files keyed by
Notion's 32-char page id. Page ids are stable — renaming a page in Notion
does not change its filename.

## For editors (working in Notion)

Everything an editor needs to know:

### Add a new page

Create a sub-page under the section it belongs to. The position you place
it in (drag in the Notion sidebar) is the order it appears in our sidebar.
Set the page title — that's the only thing translators will see.

### Publish a page

Set the page **icon** to ✅. The pipeline only publishes ✅ pages. Pages
with any other icon (or no icon) are treated as drafts and are skipped —
their last published version stays live until you flip them to ✅.

### Take down a page

Archive the page in Notion (or move it out of the docs tree). The next
sync deletes the file; old URLs continue to redirect to the section's
nearest still-published page via the redirect ledger.

### Rename or move

Just rename or drag the page where you want it. The URL changes on the
next sync, **but old URLs keep working** — every prior URL is recorded in
`static/redirect-history.json` and emitted as a 302 redirect from
`static/_redirects`. Bookmarks and external links stay valid.

> 302s during development; we'll flip to 301 (permanent) once the URL
> space stabilises.

### Where to look if something didn't publish

After the sync runs, the pipeline summary line says how many pages were
written, how many were skipped, and how many broken cross-page links it
found. Look for `[notion-export]` lines in the Action logs:

```
[notion-export] Walked 60 pages (32 ready, 28 draft) in 60s
[notion-export] Files: 0 written, 32 unchanged, ...; 177 redirects, 0 broken links
```

Drafts (28 above) include any page without ✅. If a page you expected to
publish is in the draft count, check its icon.

Broken-link warnings appear when a published page contains a
`<mention-page>` pointing at a draft or archived page. Either publish the
target or remove the link.

## For developers (working in this repo)

### Toolchain

- **Node 24+** with native TypeScript execution (no transform step).
- **pnpm** for package management. Lockfile is `pnpm-lock.yaml`. Do not
  introduce `npm`, `yarn`, or `bun`.
- **Vitest** for tests.

```bash
pnpm install
pnpm run prepare      # one-time: install the pre-commit hook (.githooks/pre-commit)
pnpm dev              # Docusaurus dev server
pnpm build            # static site → build/
pnpm serve            # serve the built site
pnpm test             # vitest
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint src
```

### Pipeline commands

```bash
pnpm notion:walk             # smoke-test the Notion connection; prints the tree
pnpm notion:export           # full pipeline → writes docs/, images, redirects
pnpm notion:export:dry-run   # preview the diff without writing docs/redirects/manifest
```

The pipeline is idempotent: rerunning it with no Notion changes produces
zero git diff.

### File layout

- `docs/` — generated Markdown (committed)
- `static/` — generated `_redirects`, `redirect-history.json`, images
- `scripts/notion-export/` — pipeline source
- `src/plugins/canonical-slugs/` — Docusaurus hook that injects `slug:`
  per page from the manifest the pipeline emits
- `legacy/` — old architecture, reference-only — **do not import or imitate**

### Ops setup

The two-branch publish workflow (Cloudflare Pages, branch protection,
secrets) is documented in [`RUNBOOK.md`](RUNBOOK.md). One-time setup
only; day-to-day contributors don't need it.

### Plans

The architecture source-of-truth docs live in
[`.claude/skills/notion-markdown-export/`](.claude/skills/notion-markdown-export/):

- `tree-publish-plan.md` — page tree, URL/slug pattern, redirects,
  two-branch publish, phasing
- `transforms-plan.md` — HTML / callout / image transforms
- `translations-decision.md` — Crowdin (active translation plan)
- `translations-plan.md` — older Weblate plan (fallback reference)
- `SKILL.md` — Notion Markdown Content API reference

If the plans and the code disagree, the plans win — propose an update
rather than silently diverging.

## Translations

Phase 4.5 will integrate **Crowdin** against the `published` branch; see
`.claude/skills/notion-markdown-export/translations-decision.md`.
Translators edit titles + body segments in Crowdin's web editor; the
URL for each locale is computed at build time from the translated title.

The prep files are already in the repo (inert until Crowdin is wired):

- `crowdin.yml` — config; `project_id` set to a placeholder until OSS approval lands
- `.github/workflows/translation-pr.yml` — CI gate for PRs touching `i18n/**`
- `.githooks/pre-commit` — blocks direct edits to `i18n/<locale>/.../*.md`
- `glossary/comapeo-docs.csv` — starter glossary (product terms; expand as needed)

## Pull requests

- Keep changes scoped. A pipeline change and a Docusaurus theme change
  belong in separate PRs.
- New transforms go in `scripts/notion-export/transform.ts` with tests
  next to the file.
- New fetch calls go through `scripts/notion-export/fetch.ts` — never
  call `fetch()` directly to Notion or external image hosts.
- Don't hand-edit anything in `docs/`, `static/_redirects`, or
  `static/redirect-history.json` — those are pipeline output.
