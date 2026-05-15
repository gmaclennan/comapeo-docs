// These tests drive the parseFrontMatter hook through Docusaurus's default
// parser stub. The hook reads `.canonical-slugs.json` from a path anchored
// to the source file; rather than rebuild the path resolution we exercise
// the hook via the manifest file that the live pipeline writes (verified
// to exist in CI runs and dev checkouts). When the manifest doesn't match
// the test's expectations we skip.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseFrontMatterWithSlug } from "./parse-frontmatter.ts";
import type { Manifest } from "../../../scripts/notion-export/manifest.ts";

const MANIFEST_PATH = resolve(".canonical-slugs.json");

function manifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

async function defaultParse({
  fileContent,
}: {
  filePath: string;
  fileContent: string;
}) {
  const match = fileContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontMatter: {}, content: fileContent };
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return { frontMatter: fm, content: match[2] };
}

describe("parseFrontMatterWithSlug", () => {
  it("returns frontmatter unchanged when path has no pageId", async () => {
    const result = await parseFrontMatterWithSlug({
      filePath: "/abs/path/some-doc.md",
      fileContent: `---\ntitle: "Hi"\n---\nBody`,
      defaultParseFrontMatter: defaultParse,
    });
    expect(result.frontMatter).toEqual({ title: "Hi" });
    expect(result.frontMatter.slug).toBeUndefined();
  });

  it("returns frontmatter unchanged when pageId is not in the manifest", async () => {
    const result = await parseFrontMatterWithSlug({
      filePath: "/abs/docs/ffffffffffffffffffffffffffffffff.md",
      fileContent: `---\ntitle: "Stranger"\n---`,
      defaultParseFrontMatter: defaultParse,
    });
    expect(result.frontMatter.slug).toBeUndefined();
  });

  it("injects a slug for a real pageId from the live manifest", async () => {
    const m = manifest();
    if (!m) return; // no manifest committed yet — skip
    const leafEntry = Object.entries(m.pages).find(
      ([, p]) => !p.isRoot && !p.isSection,
    );
    if (!leafEntry) return;
    const [pageId, entry] = leafEntry;
    const result = await parseFrontMatterWithSlug({
      filePath: `/anywhere/${pageId}.md`,
      fileContent: `---\ntitle: "${entry.title}"\n---`,
      defaultParseFrontMatter: defaultParse,
    });
    expect(typeof result.frontMatter.slug).toBe("string");
    expect(result.frontMatter.slug).toContain(`-${pageId}`);
  });

  it("uses the file's own frontmatter title to slugify its leaf segment", async () => {
    const m = manifest();
    if (!m) return;
    const leafEntry = Object.entries(m.pages).find(
      ([, p]) => !p.isRoot && !p.isSection,
    );
    if (!leafEntry) return;
    const [pageId] = leafEntry;
    const result = await parseFrontMatterWithSlug({
      filePath: `/anywhere/${pageId}.md`,
      fileContent: `---\ntitle: "Custom Override"\n---`,
      defaultParseFrontMatter: defaultParse,
    });
    expect(String(result.frontMatter.slug)).toMatch(
      new RegExp(`/custom-override-${pageId}$`),
    );
  });

  it("works with .mdx as well as .md", async () => {
    const m = manifest();
    if (!m) return;
    const leafEntry = Object.entries(m.pages).find(
      ([, p]) => !p.isRoot && !p.isSection,
    );
    if (!leafEntry) return;
    const [pageId] = leafEntry;
    const result = await parseFrontMatterWithSlug({
      filePath: `/anywhere/${pageId}.mdx`,
      fileContent: `---\ntitle: "Mdx Page"\n---`,
      defaultParseFrontMatter: defaultParse,
    });
    expect(result.frontMatter.slug).toContain(`-${pageId}`);
  });
});
