import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { syncFilesystem } from "./write-files.ts";
import type { Page, Pages } from "./walk-tree.ts";

const ROOT = "00000000000000000000000000000000";
const A = "11111111111111111111111111111111";
const B = "22222222222222222222222222222222";

function page(overrides: Partial<Page> & Pick<Page, "id">): Page {
  return {
    parentId: null,
    ancestorIds: [],
    childIds: [],
    depth: 0,
    position: 0,
    title: "",
    icon: null,
    ready: false,
    markdown: "",
    truncated: false,
    unknownBlockIds: [],
    mentionIds: [],
    relPath: `${overrides.id}.md`,
    dirSegments: [],
    ...overrides,
  };
}

function makePages(...entries: Page[]): Pages {
  return new Map(entries.map((p) => [p.id, p]));
}

async function seed(docsDir: string, relPath: string, body: string): Promise<void> {
  const abs = join(docsDir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

function fileExists(docsDir: string, relPath: string): boolean {
  return existsSync(join(docsDir, relPath));
}

async function readBody(docsDir: string, relPath: string): Promise<string> {
  return readFile(join(docsDir, relPath), "utf8");
}

describe("syncFilesystem", () => {
  let docsDir: string;

  beforeEach(async () => {
    docsDir = await mkdtemp(join(tmpdir(), "notion-export-test-"));
  });

  afterEach(async () => {
    await rm(docsDir, { recursive: true, force: true });
  });

  it("writes a new file for a ✅ page", async () => {
    const pages = makePages(page({ id: A, ready: true, body: "hello\n" }));
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.written).toBe(1);
    expect(summary.unchanged).toBe(0);
    expect(summary.moved).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(await readBody(docsDir, `${A}.md`)).toBe("hello\n");
  });

  it("reports unchanged when content matches existing file", async () => {
    await seed(docsDir, `${A}.md`, "hello\n");
    const pages = makePages(page({ id: A, ready: true, body: "hello\n" }));
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.written).toBe(0);
    expect(summary.unchanged).toBe(1);
  });

  it("rewrites a file whose content changed", async () => {
    await seed(docsDir, `${A}.md`, "old\n");
    const pages = makePages(page({ id: A, ready: true, body: "new\n" }));
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.written).toBe(1);
    expect(summary.unchanged).toBe(0);
    expect(await readBody(docsDir, `${A}.md`)).toBe("new\n");
  });

  it("moves a renamed page (file lives at the new dirSegments path)", async () => {
    await seed(docsDir, `old-section/${A}.md`, "body\n");
    const pages = makePages(
      page({
        id: A,
        ready: true,
        body: "body\n",
        dirSegments: ["new-section"],
        relPath: `new-section/${A}.md`,
      }),
    );
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.moved).toBe(1);
    // Content identical, so it counts as "unchanged" content alongside the move.
    expect(summary.unchanged).toBe(1);
    expect(fileExists(docsDir, `old-section/${A}.md`)).toBe(false);
    expect(fileExists(docsDir, `new-section/${A}.md`)).toBe(true);
  });

  it("moves AND rewrites when both path and content change", async () => {
    await seed(docsDir, `old-section/${A}.md`, "old body\n");
    const pages = makePages(
      page({
        id: A,
        ready: true,
        body: "new body\n",
        dirSegments: ["new-section"],
        relPath: `new-section/${A}.md`,
      }),
    );
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.moved).toBe(1);
    expect(summary.written).toBe(1);
    expect(await readBody(docsDir, `new-section/${A}.md`)).toBe("new body\n");
  });

  it("deletes files for pages no longer in the tree (archived)", async () => {
    await seed(docsDir, `${A}.md`, "abandoned\n");
    const pages = makePages(page({ id: B, ready: true, body: "still here\n" }));
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.deleted).toBe(1);
    expect(fileExists(docsDir, `${A}.md`)).toBe(false);
    expect(fileExists(docsDir, `${B}.md`)).toBe(true);
  });

  it("preserves files for 🚧 pages that are still in the tree", async () => {
    await seed(docsDir, `${A}.md`, "last published body\n");
    const pages = makePages(page({ id: A, ready: false /* no body */ }));
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.deleted).toBe(0);
    expect(summary.unchanged).toBe(0);
    expect(summary.written).toBe(0);
    // File is left in place untouched.
    expect(await readBody(docsDir, `${A}.md`)).toBe("last published body\n");
  });

  it("cleans up an orphan _category_.json left after a section rename", async () => {
    // Seed the old section dir with the moved file PLUS a stale category file.
    await seed(docsDir, `old-section/${A}.md`, "body\n");
    await seed(
      docsDir,
      `old-section/_category_.json`,
      `{"label":"Old","position":0,"link":{"type":"doc","id":"old-section/${A}"}}`,
    );
    const pages = makePages(
      page({
        id: A,
        ready: true,
        body: "body\n",
        dirSegments: ["new-section"],
        relPath: `new-section/${A}.md`,
      }),
    );
    await syncFilesystem(pages, { docsDir });
    expect(fileExists(docsDir, `old-section/_category_.json`)).toBe(false);
    expect(fileExists(docsDir, `old-section`)).toBe(false);
  });

  it("is idempotent: running twice with no changes is a no-op", async () => {
    const pages = makePages(page({ id: A, ready: true, body: "hello\n" }));
    await syncFilesystem(pages, { docsDir });
    const summary2 = await syncFilesystem(pages, { docsDir });
    expect(summary2.written).toBe(0);
    expect(summary2.unchanged).toBe(1);
    expect(summary2.moved).toBe(0);
    expect(summary2.deleted).toBe(0);
  });

  it("ignores non-pageId .md files in docs/", async () => {
    await seed(docsDir, `not-a-pageid.md`, "user content\n");
    const pages = makePages(page({ id: A, ready: true, body: "hello\n" }));
    const summary = await syncFilesystem(pages, { docsDir });
    expect(summary.deleted).toBe(0);
    // The unrelated file is still there.
    expect(fileExists(docsDir, "not-a-pageid.md")).toBe(true);
  });
});

