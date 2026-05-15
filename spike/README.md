# Notion Markdown Content API spike

Validates whether `GET /v1/pages/:page_id/markdown` (Notion API version `2026-03-11`)
can replace most of `scripts/notion-fetch/` (~38K LOC) with ~500 LOC of glue.

## What this spike does

1. **Fetches** 5 representative pages via the Markdown Content API (one call per page,
   no recursive block walking).
2. **Inspects** the output — what does the API actually return for callouts, toggles,
   images, tables, sub-pages, columns?
3. **Downloads images** with a minimal ~80 LOC implementation (no compression, no cache),
   rewrites URLs to local paths.
4. **Converts callouts** from `<callout>...</callout>` to Docusaurus `:::admonition` syntax
   using a first-emoji editorial convention.

Output for each page: `raw.json`, `raw.md`, `with-images.md`, `processed.md`, `images/`.

## Setup

### 1. Install p-limit

```bash
bun add -D p-limit
```

### 2. Make sure your `.env` has the right credentials

```bash
NOTION_API_KEY=secret_...              # the Notion integration token
DATA_SOURCE_ID=...                     # preferred (Notion API v5)
# DATABASE_ID=...                      # fallback if you don't have data source ID yet
```

The integration must have **read access** to the pages you want to test (you may need to
add it as a connection in your Notion workspace). Anyone reading this who already runs
`bun run notion:fetch` successfully is already set up.

### 3. List available pages and pick 5

```bash
bun spike/list-pages.ts
```

This prints all pages in the data source with id, language, status, and title.
**Pick 5 English pages with varied content** — ideally:
- one with **callouts** (Notion blue/yellow/red boxes)
- one with **images** (screenshots, diagrams)
- one with a **toggle** (collapsible section)
- one with a **table**
- one with **sub-pages** (a parent page that has children)

Put their IDs in `spike/page-ids.txt`, one per line:

```
abc123-...
def456-...
...
```

### 4. Run the spike

```bash
bun spike/run-spike.ts
```

Or pass IDs directly:

```bash
bun spike/run-spike.ts abc123 def456 ghi789
```

## What to look for in the output

Open `spike/output/<n>-<page-id>/` and check:

### `raw.md` — what the API returns natively

- Are **callouts** rendered as `<callout>...</callout>`? (Expected — but no color/icon, so see callout convention below.)
- Are **toggles** rendered as `<details><summary>title</summary>...</details>`? (Should work in MDX as-is.)
- Are **tables** HTML `<table>` or GFM `|---|---|`? (HTML expected — also fine in MDX.)
- Are **columns** rendered as `<columns><column>...</column></columns>`? (You'll need to wire up a Docusaurus MDX component if you keep them.)
- Are **sub-page links** rendered as `<page url="...">title</page>`? (Will need rewriting to relative MD links — easy.)
- Are **images** `![alt](url)` with pre-signed S3 URLs? (Expected — they expire ~1h, so download is mandatory.)
- Anything `<unknown>` blocks? (Embeds, bookmarks, link previews currently render as unknown — list them so we know what we'd lose.)

### `processed.md` — after image + callout rewriting

- Does it look like valid Docusaurus MDX?
- Did all images download (check `images/` folder)?
- Did callouts pick reasonable types based on emojis?

### Console output

- **Fetch time per page** — should be well under 1 second
- **Total time for 5 pages** — should be under ~5 seconds
- **Truncated?** — should be false (truncation kicks in at ~20K blocks)
- **Block type counts** — tells you which Notion features your real content uses

## Editorial convention for callouts

Since the Markdown API doesn't expose callout color/icon, this spike uses the
**first emoji as the type marker**:

| Prefix emoji | Becomes |
|---|---|
| 💡 🟢 ✅ | `:::tip` |
| ⚠️ 🟡 🟠 | `:::warning` |
| 🔥 ❌ 🛑 🚫 🔴 | `:::danger` |
| ❗ ⚡ 🚨 | `:::caution` |
| ℹ️ 📘 📋 🔵 📝 | `:::info` |
| (anything else) | `:::note` |

If this spike validates, the team should adopt this as a documented authoring convention.

## What the spike does NOT do

This is a spike, not the production rewrite. Out of scope:

- Page tree walking (the spike processes a flat list of IDs)
- Frontmatter generation (you can copy the existing `scripts/notion-fetch/frontmatterBuilder.ts`)
- i18n routing (English-only here)
- Custom emoji image downloading (notion-static.com expiring URLs)
- Image compression (let the CDN handle it)
- Sub-page link rewriting to relative paths
- Column / video / file MDX component shims
- Status filtering (just process whatever IDs you give it)

If the spike validates the API, the production version is roughly: tree walker +
this spike's `lib/` + frontmatter builder + sub-page link rewriter + i18n routing.

## Cleanup

```bash
rm -rf spike/output spike/page-ids.txt
git checkout main
git branch -D spike/notion-markdown-api
```
