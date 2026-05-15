import { describe, expect, it } from "vitest";
import { computeSlug } from "./compute-slug.ts";
import type { Manifest } from "../../../scripts/notion-export/manifest.ts";

const ROOT = "00000000000000000000000000000000";
const SECTION = "11111111111111111111111111111111";
const ARTICLE = "22222222222222222222222222222222";
const SUB_SECTION = "33333333333333333333333333333333";
const LEAF = "44444444444444444444444444444444";

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
      title: "Install CoMapeo",
      parentId: SECTION,
      ancestorIds: [ROOT, SECTION],
      isSection: false,
      isRoot: false,
    },
    [SUB_SECTION]: {
      title: "Photos",
      parentId: SECTION,
      ancestorIds: [ROOT, SECTION],
      isSection: true,
      isRoot: false,
    },
    [LEAF]: {
      title: "Edit a photo",
      parentId: SUB_SECTION,
      ancestorIds: [ROOT, SECTION, SUB_SECTION],
      isSection: false,
      isRoot: false,
    },
  },
};

const titles = new Map<string, string>(
  Object.entries(manifest.pages).map(([id, entry]) => [id, entry.title]),
);

function slug(pageId: string, overrideTitles?: Map<string, string>): string {
  return computeSlug({
    pageId,
    manifest,
    titlesByPageId: overrideTitles ?? titles,
  });
}

describe("computeSlug", () => {
  it("root page maps to '/'", () => {
    expect(slug(ROOT)).toBe("/");
  });

  it("section page (depth 1) uses its own slug-pageId", () => {
    expect(slug(SECTION)).toBe(`/getting-started-${SECTION}`);
  });

  it("article (depth 2) includes parent section's slug-pageId", () => {
    expect(slug(ARTICLE)).toBe(
      `/getting-started-${SECTION}/install-co-mapeo-${ARTICLE}`,
    );
  });

  it("sub-section (depth 2) is a section itself", () => {
    expect(slug(SUB_SECTION)).toBe(
      `/getting-started-${SECTION}/photos-${SUB_SECTION}`,
    );
  });

  it("leaf in sub-section (depth 3) walks the full ancestor chain", () => {
    expect(slug(LEAF)).toBe(
      `/getting-started-${SECTION}/photos-${SUB_SECTION}/edit-a-photo-${LEAF}`,
    );
  });

  it("uses overridden titles (e.g. translated) when provided", () => {
    const localized = new Map(titles);
    localized.set(SECTION, "Comenzar");
    localized.set(ARTICLE, "Instalar CoMapeo");
    expect(slug(ARTICLE, localized)).toBe(
      `/comenzar-${SECTION}/instalar-co-mapeo-${ARTICLE}`,
    );
  });

  it("falls back to manifest titles for ancestors not in the override map", () => {
    const partial = new Map<string, string>();
    partial.set(ARTICLE, "Instalar"); // only the leaf is overridden
    expect(slug(ARTICLE, partial)).toBe(
      `/getting-started-${SECTION}/instalar-${ARTICLE}`,
    );
  });

  it("falls back to 'untitled' for empty titles", () => {
    const empty = new Map<string, string>();
    empty.set(ARTICLE, "");
    expect(slug(ARTICLE, empty)).toBe(
      `/getting-started-${SECTION}/untitled-${ARTICLE}`,
    );
  });

  it("falls back to 'untitled' when slugify reduces title to empty (emoji/symbols)", () => {
    const overrides = new Map<string, string>([[ARTICLE, "🚀✨"]]);
    expect(slug(ARTICLE, overrides)).toBe(
      `/getting-started-${SECTION}/untitled-${ARTICLE}`,
    );
    expect(slug(ARTICLE, new Map([[ARTICLE, "---"]]))).toBe(
      `/getting-started-${SECTION}/untitled-${ARTICLE}`,
    );
  });

  it("strips trailing hyphens after 60-char truncation", () => {
    // 60th char lands at a hyphen position → without the strip we'd get `foo--<pageId>`.
    const title = "word ".repeat(40); // produces "word-word-word-..." after slugify
    const result = slug(ARTICLE, new Map([[ARTICLE, title]]));
    const lastSeg = result.split("/").at(-1)!;
    const [prefix] = lastSeg.split(/-(?=[0-9a-f]{32}$)/);
    expect(prefix.endsWith("-")).toBe(false);
    expect(prefix.length).toBeLessThanOrEqual(60);
  });

  it("throws for unknown pageId", () => {
    expect(() => slug("ffffffffffffffffffffffffffffffff")).toThrow(
      /not in manifest/,
    );
  });

  it("truncates very long slugified titles to 60 chars (preserves pageId)", () => {
    const long = "a".repeat(100);
    const overrides = new Map<string, string>([[ARTICLE, long]]);
    const result = slug(ARTICLE, overrides);
    // expected last segment: <60 a's>-<pageId>
    const lastSeg = result.split("/").at(-1)!;
    const [prefix, id] = lastSeg.split(/-(?=[0-9a-f]{32}$)/);
    expect(prefix.length).toBe(60);
    expect(id).toBe(ARTICLE);
  });
});
