import { describe, expect, it } from "vitest";
import { buildRedirects, formatRedirects } from "./redirects.ts";
import {
  appendIfNew,
  emptyHistory,
  slugPrefix,
  type RedirectHistory,
} from "./redirect-history.ts";
import type { Manifest } from "./manifest.ts";

const ROOT = "00000000000000000000000000000000";
const SECTION = "11111111111111111111111111111111";
const ARTICLE = "22222222222222222222222222222222";

const manifest: Manifest = {
  version: 1,
  rootId: ROOT,
  pages: {
    [ROOT]: {
      title: "Root",
      parentId: null,
      ancestorIds: [],
      isSection: true,
      isRoot: true,
    },
    [SECTION]: {
      title: "Getting Started",
      parentId: ROOT,
      ancestorIds: [ROOT],
      isSection: true,
      isRoot: false,
    },
    [ARTICLE]: {
      title: "Install",
      parentId: SECTION,
      ancestorIds: [ROOT, SECTION],
      isSection: false,
      isRoot: false,
    },
  },
};

describe("buildRedirects", () => {
  it("emits a bare-ID alias per page per locale", () => {
    const history = emptyHistory();
    const redirects = buildRedirects(manifest, history);
    // 2 non-root pages × 3 locales = 6 bare-ID aliases
    const bareIds = redirects.filter((r) =>
      /\/[0-9a-f]{32}$/.test(r.from),
    );
    expect(bareIds).toHaveLength(6);
    expect(bareIds.map((r) => r.from)).toContain(`/docs/${ARTICLE}`);
    expect(bareIds.map((r) => r.from)).toContain(`/es/docs/${ARTICLE}`);
    expect(bareIds.map((r) => r.from)).toContain(`/pt/docs/${ARTICLE}`);
  });

  it("bare-ID alias points at the current canonical slug", () => {
    const history = emptyHistory();
    const redirects = buildRedirects(manifest, history);
    const bareId = redirects.find(
      (r) => r.from === `/docs/${ARTICLE}`,
    );
    expect(bareId?.to).toBe(
      `/docs/getting-started-${SECTION}/install-${ARTICLE}`,
    );
  });

  it("does not emit a self-redirect for the root", () => {
    const history = emptyHistory();
    const redirects = buildRedirects(manifest, history);
    for (const r of redirects) {
      expect(r.from).not.toBe("/");
      expect(r.from).not.toMatch(new RegExp(`/${ROOT}$`));
    }
  });

  it("emits a prior-slug alias when a page's slug changes between runs", () => {
    const history: RedirectHistory = {};
    // First run: appendIfNew seeds the current slug.
    buildRedirects(manifest, history);
    // Rename the article and re-run.
    const renamed: Manifest = {
      ...manifest,
      pages: {
        ...manifest.pages,
        [ARTICLE]: { ...manifest.pages[ARTICLE], title: "Installing CoMapeo" },
      },
    };
    const redirects = buildRedirects(renamed, history);
    const priorUrl = `/docs/getting-started-${SECTION}/install-${ARTICLE}`;
    const newCanonical = `/docs/getting-started-${SECTION}/installing-co-mapeo-${ARTICLE}`;
    const aliases = redirects.filter((r) => r.from === priorUrl);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].to).toBe(newCanonical);
  });

  it("does not duplicate history entries when slug is unchanged", () => {
    const history: RedirectHistory = {};
    buildRedirects(manifest, history);
    buildRedirects(manifest, history);
    expect(history[ARTICLE]?.en.length).toBe(1);
  });

  it("emits redirects for every prior slug, not just the most recent", () => {
    const history: RedirectHistory = {};
    // Seed three prior slugs manually (stored without leading slash, per slugPrefix).
    appendIfNew(history, ARTICLE, "en", "alpha");
    appendIfNew(history, ARTICLE, "en", "beta");
    appendIfNew(history, ARTICLE, "en", "gamma");
    // Current run will add the manifest-derived current slug as the 4th entry.
    const redirects = buildRedirects(manifest, history);
    const enAliases = redirects.filter(
      (r) =>
        r.from.startsWith("/docs/") &&
        !r.from.startsWith("/es") &&
        !r.from.startsWith("/pt") &&
        r.from.includes(ARTICLE) &&
        r.from !== `/docs/${ARTICLE}`,
    );
    // Three prior prefixes (alpha, beta, gamma) → three aliases for EN.
    expect(enAliases).toHaveLength(3);
  });

  it("skips emitting an alias whose source IS the canonical URL", () => {
    const history: RedirectHistory = {};
    // Pre-seed with a prefix that resolves back to the current canonical URL.
    appendIfNew(history, ARTICLE, "en", `getting-started-${SECTION}/install`);
    // appendIfNew with a different prefix bumps the list so this becomes "prior".
    appendIfNew(history, ARTICLE, "en", "tmp");
    const redirects = buildRedirects(manifest, history);
    // No EN alias from the canonical URL to itself.
    const selfAlias = redirects.find(
      (r) =>
        r.from === `/docs/getting-started-${SECTION}/install-${ARTICLE}` &&
        r.to === r.from,
    );
    expect(selfAlias).toBeUndefined();
  });
});

describe("slugPrefix", () => {
  it("strips the -<pageId> suffix AND the leading slash from a canonical slug", () => {
    expect(slugPrefix(`/foo/bar-baz-${ARTICLE}`, ARTICLE)).toBe(
      `foo/bar-baz`,
    );
  });

  it("returns empty for root", () => {
    expect(slugPrefix("/", ARTICLE)).toBe("");
  });

  it("returns the slug without leading slash even if no suffix matches", () => {
    expect(slugPrefix(`/foo/no-suffix`, ARTICLE)).toBe(`foo/no-suffix`);
  });
});

describe("formatRedirects", () => {
  it("emits Cloudflare _redirects format with status code", () => {
    const out = formatRedirects([
      { from: "/a", to: "/b", status: 302 },
      { from: "/c", to: "/d", status: 302 },
    ]);
    expect(out).toContain("/a /b 302");
    expect(out).toContain("/c /d 302");
    expect(out.startsWith("# Generated")).toBe(true);
  });

  it("ends with a trailing newline", () => {
    const out = formatRedirects([]);
    expect(out.endsWith("\n")).toBe(true);
  });
});
