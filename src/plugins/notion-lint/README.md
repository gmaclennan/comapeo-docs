# notion-lint

Remark transformer that strips `data-notion-lint="..."` marker nodes from MDAST.

## What and why

The notion-export pipeline emits visible markers in `docs/**/*.md` when it detects content-quality issues:

| Marker | Where it comes from |
|---|---|
| `<span data-notion-lint="broken-link" …>⚠️ broken link</span>` | `scripts/notion-export/validate.ts` — cross-page link whose target isn't a published page |
| `<div data-notion-lint="missing-image" …>⚠️ Missing image</div>` | `scripts/notion-export/images.ts` — image fetch failure, unresolved `file://`, or bare-filename |
| `<div data-notion-lint="truncated">⚠️ Truncated by Notion API …</div>` | `scripts/notion-export/index.ts` — page truncated AND has no unknown blocks |

Markers are styled in `src/css/custom.css` so reviewers can spot them on the staging Cloudflare preview. The lint workflow (`.github/workflows/lint-content.yml`) greps for `data-notion-lint=` on the `staging → published` PR and fails the check if any are present.

This plugin is the second line of defence: if an admin overrides branch protection and merges a PR with markers, the production build still strips them so the deployed site stays visually clean.

## Wiring

`docusaurus.config.ts` registers the remark transformer when `IS_PRODUCTION=true`:

```ts
const isProduction = process.env.IS_PRODUCTION === "true";

presets: [
  ["classic", {
    docs: {
      // ...
      remarkPlugins: isProduction ? [stripNotionLintMarkers] : [],
    },
    // ...
  }],
]
```

## Implementation

`strip-markers.ts` walks the MDAST recursively and removes:
- `mdxJsxFlowElement` / `mdxJsxTextElement` nodes whose `attributes[].name === "data-notion-lint"`
- `html` nodes whose `value` contains `data-notion-lint=`

The HTML fallback covers older MDX parsing modes; with `future.v4: true` Docusaurus parses HTML-in-markdown as JSX, so the MDX branch is the active path.
