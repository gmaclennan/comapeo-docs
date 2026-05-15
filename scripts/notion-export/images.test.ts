import { describe, expect, it, vi } from "vitest";
import { categorizeUrl, resolveFileUrls } from "./images.ts";

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
