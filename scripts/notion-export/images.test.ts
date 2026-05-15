import { describe, expect, it } from "vitest";
import { categorizeUrl } from "./images.ts";

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
