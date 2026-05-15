# Legacy code (reference-only)

Everything in this directory is from CoMapeo Docs' previous architecture. **Not maintained. Not imported by any active code.** Kept here as occasional reference while the replacement is being built.

## Why this exists

The previous Notion → Docusaurus pipeline (~85K LOC of TypeScript) was being replaced as of 2026-05-15. No production site relies on it, so there are no migration concerns — the entire stack moves out of the active codebase at once.

## What's here

- `scripts/` — old Notion sync, translation, content-cleanup scripts
- `api-server/` — Bun-based API service for content automation
- `bun-tests/` — Bun-runtime tests
- `context/` — supporting documentation for the old architecture (database schemas, workflows, etc.)
- `.github/workflows/` — old CI workflows (translate-docs, deploy-production, deploy-staging, etc.)
- `.github/CLOUDFLARE_SETUP.md` — Cloudflare config for the old preview-deploy flow
- `AGENTS.legacy.md`, `CLAUDE.legacy.md`, `CONTRIBUTING.legacy.md`, `README.legacy.md` — old agent + contributor docs, renamed so auto-loaders don't pick them up
- `NOTION_FETCH_ARCHITECTURE.md` — debug notes from the previous fetch pipeline
- `bunfig.toml`, `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, `lefthook.yml`, `sync-claude-md.sh` — tooling files specific to the old setup
- `content-lock.sha` — the SHA-pinning mechanism the old production deploy used
- `SETUP.md` — old setup instructions

## When to consult it

Rarely. Prefer the active source of truth instead:

- Architecture plans → `.claude/skills/notion-markdown-export/{tree-publish-plan,translations-plan,transforms-plan,SKILL}.md`
- New code → `scripts/notion-export/` (Phase 2+) and `src/`
- Project guidance → root `CLAUDE.md`

Only fall back to this directory when:

- Investigating a specific Notion API edge case or block-type quirk that's documented nowhere else
- Recovering a callout / emoji / image mapping table that needs to be ported (and verifying it's still relevant first)

When tempted to "do it the way legacy did," check the plan docs instead. Legacy decisions were optimized for a different architecture and may actively mislead.
