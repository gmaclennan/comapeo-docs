import { describe, expect, it, vi } from "vitest";
import { resolveFileAttachmentUrl } from "./file-attachments.ts";
import type { ImageBlockResponse } from "./fetch.ts";

const BLOCK_ID = "043c90f2-2b63-834d-b188-8143d552780c";
const S3_URL =
  "https://prod-files-secure.s3.us-west-2.amazonaws.com/spaceid/attachmentid/photo.png?X-Amz-Algorithm=...";

// A realistic file:// URL from the legacy data source (spike capture).
// The decoded JSON contains the block id we need to fetch.
const VALID_URL =
  "file://%7B%22source%22%3A%22attachment%3A700512df-7129-4c48-8dbb-ce94ba61ad63%3ACaptura_de_pantalla_2026-04-09_a_la(s)_8.51.28_p.m..png%22%2C%22permissionRecord%22%3A%7B%22table%22%3A%22block%22%2C%22id%22%3A%22" +
  BLOCK_ID +
  "%22%2C%22spaceId%22%3A%22684f01df-7f8c-4dfe-8254-fad078c25e16%22%7D%7D";

function imageBlock(
  url: string,
  type: "file" | "external" = "file",
): ImageBlockResponse {
  return {
    object: "block",
    id: BLOCK_ID,
    type: "image",
    image:
      type === "file"
        ? { type: "file", file: { url, expiry_time: "2026-05-15T15:00:00Z" } }
        : { type: "external", external: { url } },
  };
}

describe("resolveFileAttachmentUrl", () => {
  it("decodes a realistic file:// URL and returns the resolved S3 URL", async () => {
    const fetchBlock = vi.fn().mockResolvedValue(imageBlock(S3_URL));
    const out = await resolveFileAttachmentUrl(VALID_URL, fetchBlock);
    expect(out).toBe(S3_URL);
    expect(fetchBlock).toHaveBeenCalledWith(BLOCK_ID);
  });

  it("falls back to external URL if block is type=external", async () => {
    const fetchBlock = vi
      .fn()
      .mockResolvedValue(imageBlock("https://example.com/x.png", "external"));
    expect(await resolveFileAttachmentUrl(VALID_URL, fetchBlock)).toBe(
      "https://example.com/x.png",
    );
  });

  it("returns null when block fetch returns null", async () => {
    const fetchBlock = vi.fn().mockResolvedValue(null);
    expect(await resolveFileAttachmentUrl(VALID_URL, fetchBlock)).toBe(null);
  });

  it("returns null when block fetch throws", async () => {
    const fetchBlock = vi.fn().mockRejectedValue(new Error("HTTP 404"));
    expect(await resolveFileAttachmentUrl(VALID_URL, fetchBlock)).toBe(null);
    expect(fetchBlock).toHaveBeenCalledOnce();
  });

  it("returns null for a non-file URL", async () => {
    const fetchBlock = vi.fn();
    expect(
      await resolveFileAttachmentUrl("https://example.com/x.png", fetchBlock),
    ).toBe(null);
    expect(fetchBlock).not.toHaveBeenCalled();
  });

  it("returns null for a malformed file:// URL (invalid JSON)", async () => {
    const fetchBlock = vi.fn();
    expect(
      await resolveFileAttachmentUrl("file://not-json", fetchBlock),
    ).toBe(null);
    expect(fetchBlock).not.toHaveBeenCalled();
  });

  it("returns null when JSON has no permissionRecord.id", async () => {
    const fetchBlock = vi.fn();
    const url =
      "file://" + encodeURIComponent(JSON.stringify({ source: "attachment:abc" }));
    expect(await resolveFileAttachmentUrl(url, fetchBlock)).toBe(null);
    expect(fetchBlock).not.toHaveBeenCalled();
  });

  it("returns null when the block isn't an image", async () => {
    const fetchBlock = vi.fn().mockResolvedValue({
      object: "block",
      id: BLOCK_ID,
      type: "paragraph",
    } as unknown as ImageBlockResponse);
    expect(await resolveFileAttachmentUrl(VALID_URL, fetchBlock)).toBe(null);
  });

  it("returns null when the image block has empty file.url", async () => {
    const fetchBlock = vi.fn().mockResolvedValue(imageBlock(""));
    expect(await resolveFileAttachmentUrl(VALID_URL, fetchBlock)).toBe(null);
  });
});
