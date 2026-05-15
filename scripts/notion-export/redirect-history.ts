// Append-only ledger of past canonical-slug prefixes per pageId per locale.
//
// On each pipeline run we compute the current canonical slug for every page.
// If a page's current slug differs from the last entry in its history, we
// append the new prefix and emit a 302 alias from the old URL to the new
// (see tree-publish-plan §8 — prior-slug aliases).
//
// File: `static/redirect-history.json` — committed alongside the docs so
// the production build always has the full alias history.
//
// Schema:
//   {
//     "<pageId>": {
//       "en": ["overview/introduction", "overview/getting-started"],
//       "es": [],
//       "pt": []
//     }
//   }
//
// Each value is a chronological list of canonical-slug prefixes (everything
// before the `-<pageId>` suffix). The most recent entry is the current one.

import { readFile, writeFile } from "node:fs/promises";

export type LocaleCode = "en" | "es" | "pt";

export type RedirectHistory = Record<string, Record<LocaleCode, string[]>>;

const LOCALES: LocaleCode[] = ["en", "es", "pt"];

export function emptyHistory(): RedirectHistory {
  return {};
}

export async function readHistory(path: string): Promise<RedirectHistory> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RedirectHistory;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyHistory();
    throw err;
  }
}

export async function writeHistory(
  history: RedirectHistory,
  path: string,
): Promise<void> {
  // Sort pageIds for stable diffs.
  const sorted: RedirectHistory = {};
  for (const id of Object.keys(history).sort()) {
    sorted[id] = history[id];
  }
  await writeFile(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

/**
 * Strip the trailing `-<pageId>` AND the leading `/` from a canonical slug
 * to get the prefix stored in history. For root (`/`), returns `""`.
 * Example: `/getting-started-<id>/install-<id>` → `getting-started-<id>/install`.
 */
export function slugPrefix(slug: string, pageId: string): string {
  if (slug === "/") return "";
  const suffix = `-${pageId}`;
  const stripped = slug.endsWith(suffix)
    ? slug.slice(0, -suffix.length)
    : slug;
  return stripped.startsWith("/") ? stripped.slice(1) : stripped;
}

/**
 * Append `prefix` to the history for `pageId` in `locale` if it differs
 * from the most recent entry. Returns true if a new entry was added.
 */
export function appendIfNew(
  history: RedirectHistory,
  pageId: string,
  locale: LocaleCode,
  prefix: string,
): boolean {
  let perLocale = history[pageId];
  if (!perLocale) {
    perLocale = { en: [], es: [], pt: [] };
    history[pageId] = perLocale;
  }
  const list = perLocale[locale];
  if (list.length > 0 && list[list.length - 1] === prefix) return false;
  list.push(prefix);
  return true;
}

/** Get all PRIOR prefixes (every entry except the current/last). */
export function priorPrefixes(
  history: RedirectHistory,
  pageId: string,
  locale: LocaleCode,
): string[] {
  const list = history[pageId]?.[locale] ?? [];
  if (list.length <= 1) return [];
  return list.slice(0, -1);
}

export { LOCALES };
