import { describe, expect, it, vi } from "vitest";
import {
  applyReplacements,
  categorizeUrl,
  classifyRefs,
  extractImageRefs,
  resolveFileUrls,
} from "./images.ts";
import type { Page } from "./walk-tree.ts";

// vi.mock has to be at module scope.
vi.mock("./fetch.ts", () => ({
  fetchBlock: vi.fn(async (blockId: string) => {
    if (blockId === "good-block") {
      return {
        object: "block",
        id: blockId,
        type: "image",
        image: {
          type: "file",
          file: { url: "https://s3.example/resolved.png", expiry_time: "x" },
        },
      };
    }
    return null;
  }),
}));

describe("categorizeUrl", () => {
  it("categorises Notion-hosted S3 URLs as notion-hosted", () => {
    expect(
      categorizeUrl(
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/img.png",
      ),
    ).toBe("notion-hosted");
    expect(
      categorizeUrl(
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/img.png?signature=x",
      ),
    ).toBe("notion-hosted");
  });

  it("categorises notion.so / notion.site URLs as notion-hosted", () => {
    expect(categorizeUrl("https://www.notion.so/image/x.png")).toBe(
      "notion-hosted",
    );
    expect(categorizeUrl("https://example.notion.site/img.jpg")).toBe(
      "notion-hosted",
    );
  });

  it("categorises external CDN URLs as external", () => {
    expect(
      categorizeUrl("https://upload.wikimedia.org/path/to/image.jpg"),
    ).toBe("external");
    expect(categorizeUrl("https://cdn.example.com/x.png")).toBe("external");
  });

  it("categorises file:// URLs as file", () => {
    expect(categorizeUrl("file:///path/to/local.png")).toBe("file");
    expect(categorizeUrl("file://server/share/x.png")).toBe("file");
  });

  it("categorises bare filenames as bare-filename", () => {
    expect(categorizeUrl("image.png")).toBe("bare-filename");
    expect(categorizeUrl("photos/image.png")).toBe("bare-filename");
  });

  it("categorises malformed URLs as bare-filename", () => {
    expect(categorizeUrl("not a url")).toBe("bare-filename");
  });

  it("is case-insensitive on protocol", () => {
    expect(
      categorizeUrl("HTTPS://prod-files-secure.s3.us-west-2.amazonaws.com/x"),
    ).toBe("notion-hosted");
  });
});

function fileUrl(blockId: string, filename = "photo.png"): string {
  const payload = {
    source: `attachment:abc-def:${filename}`,
    permissionRecord: { table: "block", id: blockId, spaceId: "space" },
  };
  return "file://" + encodeURIComponent(JSON.stringify(payload));
}

describe("resolveFileUrls", () => {
  it("substitutes resolved S3 URLs into markdown", async () => {
    const md = `Before\n\n![alt](${fileUrl("good-block")})\n\nAfter`;
    const out = await resolveFileUrls(md);
    expect(out.resolved).toBe(1);
    expect(out.unresolved).toBe(0);
    expect(out.markdown).toBe(
      "Before\n\n![alt](https://s3.example/resolved.png)\n\nAfter",
    );
  });

  it("leaves unresolvable file:// URLs in place", async () => {
    const url = fileUrl("missing-block");
    const md = `![](${url})`;
    const out = await resolveFileUrls(md);
    expect(out.resolved).toBe(0);
    expect(out.unresolved).toBe(1);
    expect(out.markdown).toBe(md);
  });

  it("handles a file:// URL whose filename contains parens", async () => {
    // Notion does not URL-encode `(` and `)` inside filenames. The regex
    // must still find the URL up to its `%7D` close.
    const filename = "Captura_de_pantalla_2026-04-09_a_la(s)_8.51.28_p.m..png";
    const url = fileUrl("good-block", filename);
    const md = `\t![](${url})`;
    const out = await resolveFileUrls(md);
    expect(out.resolved).toBe(1);
    expect(out.markdown).toContain("https://s3.example/resolved.png");
    expect(out.markdown).not.toContain("file://");
  });

  it("is a no-op when the markdown has no file:// URLs", async () => {
    const md = "Plain text\n\n![alt](https://example.com/x.png)";
    const out = await resolveFileUrls(md);
    expect(out.resolved).toBe(0);
    expect(out.unresolved).toBe(0);
    expect(out.markdown).toBe(md);
  });

  it("dedupes repeated file:// URLs (one block fetch per unique URL)", async () => {
    const url = fileUrl("good-block");
    const md = `![](${url})\n\n![](${url})\n\n![](${url})`;
    const out = await resolveFileUrls(md);
    expect(out.resolved).toBe(3);
    const matches = out.markdown.match(/https:\/\/s3\.example\/resolved\.png/g);
    expect(matches).toHaveLength(3);
  });
});

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    parentId: null,
    ancestorIds: [],
    childIds: [],
    depth: 0,
    position: 0,
    title: "Test page",
    icon: null,
    ready: true,
    markdown: "",
    truncated: false,
    unknownBlockIds: [],
    mentionIds: [],
    ...overrides,
  };
}

describe("extractImageRefs", () => {
  it("extracts markdown image URLs", () => {
    const md = "![alt](https://a.example/1.png)\n\n![](https://b.example/2.png)";
    expect(extractImageRefs(md)).toEqual([
      { url: "https://a.example/1.png", syntax: "markdown" },
      { url: "https://b.example/2.png", syntax: "markdown" },
    ]);
  });

  it("extracts <video|audio|file|pdf src> URLs but not <img>", () => {
    // Notion never emits <img> — see SKILL.md §Media + findings.md.
    const md = [
      `<video src="https://a.example/v.mp4">cap</video>`,
      `<audio src="https://a.example/a.mp3">cap</audio>`,
      `<file src="https://a.example/f.zip">cap</file>`,
      `<pdf src="https://a.example/p.pdf">cap</pdf>`,
      `<img src="https://a.example/should-be-ignored.png">`,
    ].join("\n");
    const refs = extractImageRefs(md);
    expect(refs).toEqual([
      { url: "https://a.example/v.mp4", syntax: "html" },
      { url: "https://a.example/a.mp3", syntax: "html" },
      { url: "https://a.example/f.zip", syntax: "html" },
      { url: "https://a.example/p.pdf", syntax: "html" },
    ]);
  });

  it("returns duplicates so lint can see every occurrence", () => {
    const url = "https://a.example/dup.png";
    const md = `![](${url})\n\n![](${url})`;
    const refs = extractImageRefs(md);
    expect(refs).toHaveLength(2);
  });
});

describe("classifyRefs", () => {
  const page = makePage({ id: "p1", title: "P1" });

  it("de-dupes downloadable refs but keeps every lint occurrence", () => {
    const refs = [
      { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/x.png", syntax: "markdown" as const },
      { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/x.png", syntax: "markdown" as const },
      { url: "broken.png", syntax: "markdown" as const },
      { url: "broken.png", syntax: "markdown" as const },
    ];
    const { downloadable, lint } = classifyRefs(refs, page);
    expect(downloadable).toHaveLength(1);
    expect(lint).toHaveLength(2);
    expect(lint.every((l) => l.category === "bare-filename")).toBe(true);
  });

  it("drops external URLs silently (no download, no lint)", () => {
    const refs = [
      { url: "https://cdn.example.com/x.png", syntax: "markdown" as const },
    ];
    const { downloadable, lint } = classifyRefs(refs, page);
    expect(downloadable).toHaveLength(0);
    expect(lint).toHaveLength(0);
  });

  it("attributes lint entries to the page id + title", () => {
    const refs = [{ url: "broken.png", syntax: "markdown" as const }];
    const { lint } = classifyRefs(refs, makePage({ id: "p2", title: "P2" }));
    expect(lint[0]).toEqual({
      pageId: "p2",
      pageTitle: "P2",
      category: "bare-filename",
      url: "broken.png",
    });
  });
});

describe("applyReplacements", () => {
  it("rewrites markdown image URLs", () => {
    const md = "![alt](https://old.example/x.png)";
    const out = applyReplacements(
      md,
      new Map([["https://old.example/x.png", "/images/notion/abc.png"]]),
    );
    expect(out).toBe("![alt](/images/notion/abc.png)");
  });

  it("rewrites <video|audio|file|pdf src> URLs", () => {
    const md = `<video src="https://old.example/v.mp4">cap</video>`;
    const out = applyReplacements(
      md,
      new Map([["https://old.example/v.mp4", "/images/notion/v.mp4"]]),
    );
    expect(out).toBe(`<video src="/images/notion/v.mp4">cap</video>`);
  });

  it("leaves URLs not in the replacement map untouched", () => {
    const md = "![a](https://stay.example/x.png) ![b](https://go.example/y.png)";
    const out = applyReplacements(
      md,
      new Map([["https://go.example/y.png", "/images/notion/y.png"]]),
    );
    expect(out).toBe(
      "![a](https://stay.example/x.png) ![b](/images/notion/y.png)",
    );
  });

  it("is a no-op when the map is empty", () => {
    const md = "![](https://a.example/x.png)";
    expect(applyReplacements(md, new Map())).toBe(md);
  });
});
