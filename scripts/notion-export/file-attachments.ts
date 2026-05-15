// Resolve Notion `file://...` URLs to their underlying S3 URL via the
// block-level API.
//
// The Markdown Content API doesn't expand `file://` attachments — it just
// emits the URL-encoded JSON pointer that Notion's internal block model
// uses. To get an actual downloadable URL we have to fetch the block
// referenced by `permissionRecord.id` and read `image.file.url`.
//
// Round-trip spike against the legacy data source confirmed this works
// (Markdown API → file:// JSON → /v1/blocks/<id> → signed S3 URL).
//
// Failure modes (all fall through to `null` so the caller can lint-warn):
//   - URL doesn't decode as JSON
//   - JSON missing `permissionRecord.id`
//   - Block fetch fails (404, permission, network)
//   - Block isn't an image, or its image has no URL

import type { ImageBlockResponse } from "./fetch.ts";

type FetchBlock = (blockId: string) => Promise<ImageBlockResponse | null>;

type FileUrlPayload = {
  source?: string;
  permissionRecord?: { id?: string };
};

function decodePayload(url: string): FileUrlPayload | null {
  if (!url.startsWith("file://")) return null;
  try {
    const json = decodeURIComponent(url.slice("file://".length));
    return JSON.parse(json) as FileUrlPayload;
  } catch {
    return null;
  }
}

export async function resolveFileAttachmentUrl(
  url: string,
  fetchBlock: FetchBlock,
): Promise<string | null> {
  const payload = decodePayload(url);
  const blockId = payload?.permissionRecord?.id;
  if (!blockId) return null;

  let block: ImageBlockResponse | null;
  try {
    block = await fetchBlock(blockId);
  } catch {
    return null;
  }
  if (!block || block.type !== "image") return null;

  // Prefer `file` (Notion-hosted S3), fall back to `external` if Notion has
  // somehow rewritten it that way.
  const u = block.image.file?.url ?? block.image.external?.url;
  return u || null;
}
