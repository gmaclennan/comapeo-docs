// End-to-end pipeline test. Wires fake Notion API + image fetch into
// runExport() and asserts the pipeline produces a consistent docs/ tree,
// canonical-slug manifest, and _redirects file.
//
// Covers regressions across walk → transform → image → write → manifest →
// redirects → validate with a single test surface.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "00000000000000000000000000000001";
const SECTION = "00000000000000000000000000000002";
const ARTICLE = "00000000000000000000000000000003";

const NOTION_HOSTED_IMG =
  "https://prod-files-secure.s3.us-west-2.amazonaws.com/test.png?X-Amz-Signature=abc";
const RESOLVED_FROM_FILE =
  "https://prod-files-secure.s3.us-west-2.amazonaws.com/resolved.png?X-Amz-Signature=xyz";
const FILE_ATTACHMENT_BLOCK_ID = "deadbeef-dead-4beef-8ead-beefdeadbeef";
const FILE_URL =
  "file://" +
  encodeURIComponent(
    JSON.stringify({
      source: "attachment:foo",
      permissionRecord: { table: "block", id: FILE_ATTACHMENT_BLOCK_ID },
    }),
  );

const ROOT_MD = `<page url="https://www.notion.so/${SECTION}">Overview</page>\n`;
const SECTION_MD = `<page url="https://www.notion.so/${ARTICLE}">Introduction</page>\n`;
const ARTICLE_MD =
  `Welcome to CoMapeo.\n\n` +
  `![Sample](${NOTION_HOSTED_IMG})\n\n` +
  `![Attachment](${FILE_URL})\n\n` +
  `See the <mention-page url="https://www.notion.so/${SECTION}"/> for context.\n`;

const fixtures: Record<string, { title: string; icon: string; markdown: string }> = {
  [ROOT]: { title: "CoMapeo Docs", icon: "✅", markdown: ROOT_MD },
  [SECTION]: { title: "Overview", icon: "✅", markdown: SECTION_MD },
  [ARTICLE]: { title: "Introduction", icon: "✅", markdown: ARTICLE_MD },
};

const blocks: Record<string, unknown> = {
  [FILE_ATTACHMENT_BLOCK_ID]: {
    object: "block",
    id: FILE_ATTACHMENT_BLOCK_ID,
    type: "image",
    image: {
      type: "file",
      file: { url: RESOLVED_FROM_FILE, expiry_time: "2026-12-31T00:00:00Z" },
    },
  },
};

vi.mock("./fetch.ts", () => ({
  normalizePageId: (id: string) => id.replace(/-/g, "").toLowerCase(),
  fetchPageMarkdown: vi.fn(async (id: string) => ({
    object: "page_markdown",
    id,
    markdown: fixtures[id]?.markdown ?? "",
    truncated: false,
    unknown_block_ids: [],
  })),
  fetchPageMeta: vi.fn(async (id: string) => ({
    object: "page",
    id,
    icon: { type: "emoji", emoji: fixtures[id]?.icon ?? "🚧" },
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: fixtures[id]?.title ?? "" }],
      },
    },
    archived: false,
    in_trash: false,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-05-15T00:00:00.000Z",
    url: `https://www.notion.so/${id}`,
  })),
  fetchBlock: vi.fn(async (blockId: string) => blocks[blockId] ?? null),
  extractTitle: (page: { properties: Record<string, unknown> }) => {
    const titleProp = Object.values(page.properties).find(
      (p): p is { type: "title"; title: Array<{ plain_text: string }> } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: string }).type === "title",
    );
    if (!titleProp) return "";
    return titleProp.title.map((t) => t.plain_text).join("");
  },
  extractIconString: (page: { icon: { type: string; emoji?: string } | null }) =>
    page.icon?.type === "emoji" ? page.icon.emoji ?? null : null,
}));

// 1×1 transparent PNG.
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_SHA12 = "2b1da20a14b9";

type RunOpts = {
  rootId: string;
  docsDir: string;
  manifestPath: string;
  redirectsPath: string;
  historyPath: string;
  imageStore: import("./images.ts").ImageStore;
};

async function newOpts(tmp: string, overrides: Partial<RunOpts> = {}): Promise<RunOpts> {
  const { LocalImageStore } = await import("./images.ts");
  return {
    rootId: ROOT,
    docsDir: join(tmp, "docs"),
    manifestPath: join(tmp, ".canonical-slugs.json"),
    redirectsPath: join(tmp, "static", "_redirects"),
    historyPath: join(tmp, "static", "redirect-history.json"),
    imageStore: new LocalImageStore(
      join(tmp, "static", "images", "notion"),
      "/images/notion",
    ),
    ...overrides,
  };
}

describe("runExport (pipeline integration)", () => {
  let tmp: string;
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: string[];

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "notion-export-test-"));
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    // Intercept image-download fetches. The notion API fetches are already
    // mocked via vi.mock("./fetch.ts").
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;
      fetchCalls.push(url);
      return new Response(PNG_1x1, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes docs, manifest, redirects, and history end-to-end", async () => {
    const { runExport } = await import("./index.ts");
    const opts = await newOpts(tmp);
    const pages = await runExport(opts);

    expect(pages.size).toBe(3);

    // Article file written at the expected path with title frontmatter.
    const articleFile = await readFile(
      join(opts.docsDir, "overview", `${ARTICLE}.md`),
      "utf8",
    );
    expect(articleFile).toContain(`title: "Introduction"`);
    // mention-page rewritten to relative MD link
    expect(articleFile).toContain(`(${SECTION}.md)`);
    // notion-hosted image rewritten to public store path
    expect(articleFile).toContain(`/images/notion/${PNG_SHA12}.png`);
    // file:// attachment was pre-resolved, downloaded, and rewritten too
    expect(articleFile).toMatch(
      new RegExp(`!\\[Attachment\\]\\(/images/notion/${PNG_SHA12}\\.png\\)`),
    );

    // Both image URLs hit fetch (notion-hosted + resolved-from-file)
    expect(fetchCalls.filter((u) => u.includes("prod-files-secure")).length).toBe(2);

    // Manifest
    const manifest = JSON.parse(await readFile(opts.manifestPath, "utf8"));
    expect(manifest.rootId).toBe(ROOT);
    expect(Object.keys(manifest.pages).sort()).toEqual([ROOT, SECTION, ARTICLE].sort());

    // _redirects uses 302 (dev choice)
    const redirects = await readFile(opts.redirectsPath, "utf8");
    expect(redirects).toContain(` 302`);
    expect(redirects).not.toContain(` 301`);
    expect(redirects).toContain(`/docs/${ARTICLE}`);
    expect(redirects).toContain(`/docs/overview-${SECTION}/introduction-${ARTICLE}`);

    // History
    const history = JSON.parse(await readFile(opts.historyPath, "utf8"));
    expect(history[ARTICLE].en).toEqual([
      `overview-${SECTION}/introduction`,
    ]);

    // _category_.json emitted for the section directory
    expect(
      existsSync(join(opts.docsDir, "overview", "_category_.json")),
    ).toBe(true);
  });

  it("is idempotent across two runs (zero content drift)", async () => {
    const { runExport } = await import("./index.ts");
    const opts = await newOpts(tmp);
    await runExport(opts);
    const first = {
      manifest: await readFile(opts.manifestPath, "utf8"),
      redirects: await readFile(opts.redirectsPath, "utf8"),
      history: await readFile(opts.historyPath, "utf8"),
      article: await readFile(
        join(opts.docsDir, "overview", `${ARTICLE}.md`),
        "utf8",
      ),
    };
    await runExport(opts);
    expect(await readFile(opts.manifestPath, "utf8")).toBe(first.manifest);
    expect(await readFile(opts.redirectsPath, "utf8")).toBe(first.redirects);
    expect(await readFile(opts.historyPath, "utf8")).toBe(first.history);
    expect(
      await readFile(join(opts.docsDir, "overview", `${ARTICLE}.md`), "utf8"),
    ).toBe(first.article);
  });

  it("appends a prior-slug redirect when the article title changes", async () => {
    const { runExport } = await import("./index.ts");
    const opts = await newOpts(tmp);
    await runExport(opts);

    // Rename Introduction → Welcome and re-run.
    fixtures[ARTICLE] = { ...fixtures[ARTICLE], title: "Welcome" };
    try {
      await runExport(opts);
    } finally {
      // Restore so other tests see the original fixture.
      fixtures[ARTICLE] = { ...fixtures[ARTICLE], title: "Introduction" };
    }

    const redirects = await readFile(opts.redirectsPath, "utf8");
    // Old canonical → new canonical
    expect(redirects).toContain(
      `/docs/overview-${SECTION}/introduction-${ARTICLE} /docs/overview-${SECTION}/welcome-${ARTICLE} 302`,
    );

    // History has both prefixes
    const history = JSON.parse(await readFile(opts.historyPath, "utf8"));
    expect(history[ARTICLE].en).toEqual([
      `overview-${SECTION}/introduction`,
      `overview-${SECTION}/welcome`,
    ]);
  });
});
