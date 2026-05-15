# Ops runbook

One-time setup steps to wire up the two-branch publish workflow (Phase 3
of the architecture, see `.claude/skills/notion-markdown-export/tree-publish-plan.md`
§7). Most contributors will never need this file — it's for whoever
provisions the GitHub + Cloudflare environment.

## Two-branch model

```
spike/notion-markdown-api    ← development branch (current)
        ↓ promote when ready
       staging               ← notion-export pipeline writes here
        ↓ PR opened automatically
      published              ← production; Cloudflare deploys on push
```

The pipeline only ever writes to `staging`. Translations (Phase 4.5,
Crowdin) will write to a separate `l10n_published` service branch.

## 1. Seed the branches

From a fresh clone or current branch on the desired starting point:

```bash
# Inspect what's about to become staging
git log --oneline -5

# Create both branches pointing at the same commit
git push origin HEAD:staging
git push origin HEAD:published
```

Verify both exist on the remote:

```bash
gh api repos/digidem/comapeo-docs/branches/staging --jq '.name'
gh api repos/digidem/comapeo-docs/branches/published --jq '.name'
```

## 2. Branch protection on `published`

```bash
gh api -X PUT repos/digidem/comapeo-docs/branches/published/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=Notion export / export' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

`enforce_admins=false` lets maintainers patch the branch in
emergencies; tighten if the team grows. The status-check name
must match the `jobs.<id>` in the workflow — `Notion export / export`
matches `name: Notion export` + `jobs.export`.

`staging` itself is intentionally unprotected; the workflow pushes
directly to it.

## 3. Secrets

The workflow needs these repo-level secrets:

| Name | Value | Notes |
|---|---|---|
| `NOTION_API_KEY` | Notion integration token | Internal integration, **read access** to the docs page tree |
| `NOTION_ROOT_PAGE_ID` | 32-char hex | The root of the page tree (no dashes) |

Set them with:

```bash
gh secret set NOTION_API_KEY      # paste when prompted
gh secret set NOTION_ROOT_PAGE_ID --body 360c90f22b6381b5a108c49dfb1ff9af
```

The default `GITHUB_TOKEN` is already injected by Actions and has the
permissions needed (declared on the job in
`.github/workflows/notion-export.yml`).

## 4. Cloudflare Pages

Two deployments, one project per environment.

### Production: `published` → docs.comapeo.app

- Connect Cloudflare Pages to `digidem/comapeo-docs`
- Production branch: `published`
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Build output directory: `build`
- Environment variable: `IS_PRODUCTION=true` (Production env only)
- Custom domain: `docs.comapeo.app`

### Staging: `staging` → staging URL

- Same project, "Preview deployments" set to track `staging`
- Environment variable (Preview): leave `IS_PRODUCTION` unset (the
  config will set `noIndex: true` so search engines ignore previews)
- Custom domain or use Cloudflare's `*.pages.dev` subdomain

Cloudflare reads `static/_redirects` automatically; no extra config
needed for the bare-ID / prior-slug aliases.

## 5. Verify the wiring

Kick a manual run and confirm the pieces:

```bash
gh workflow run notion-export.yml
gh run watch
```

Expected:

- Workflow runs against `staging`
- If Notion has changed since the last sync: a new commit appears on
  `staging`, and a PR `staging → published` is open
- If nothing changed: the workflow exits 0 with no commit and no PR
- Cloudflare staging deployment shows the result within ~2 min

Merge the PR to promote to production. Cloudflare's `published`
deployment fires automatically.

## Schedule

The workflow runs every 6 hours (`cron: "17 */6 * * *"`). Adjust in
`.github/workflows/notion-export.yml` if cadence needs to change.

## Rolling back

Two layers:

1. **Bad sync visible only on staging.** Revert the offending commit
   on `staging`; close any open PR. Next scheduled run will resync.
2. **Bad sync merged to published.** Revert the merge commit on
   `published`. Cloudflare redeploys; production returns to the prior
   state. The bare-ID and prior-slug redirects mean URLs from the
   reverted state continue to resolve.
