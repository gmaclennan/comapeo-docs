import {
  pipeline,
  withBaseUrl,
  withHeaders,
  withHttpError,
  withRateLimit,
  withRetry,
} from "fetch-extras";
import { env } from "./env.ts";

const NOTION_RATE_LIMIT_RPS = 3;

// Build the pipeline lazily so importing this module doesn't require
// NOTION_API_KEY. Tests that mock ./fetch.ts via vi.mock() never trigger
// this; production callers hit it on the first fetch.
let _notionFetch: ReturnType<typeof buildNotionFetch> | null = null;

function buildNotionFetch() {
  return pipeline(
    fetch,
    withBaseUrl("https://api.notion.com"),
    withHeaders({
      Authorization: `Bearer ${env.notionApiKey}`,
      "Notion-Version": env.notionVersion,
      "Content-Type": "application/json",
    }),
    withRateLimit({
      requestsPerInterval: NOTION_RATE_LIMIT_RPS,
      interval: 1000,
    }),
    withRetry({ retries: 3 }),
    withHttpError(),
  );
}

function getNotionFetch() {
  _notionFetch ??= buildNotionFetch();
  return _notionFetch;
}

const PAGE_ID_RE = /^[0-9a-f]{32}$/;

export function normalizePageId(id: string): string {
  const stripped = id.replace(/-/g, "").toLowerCase();
  if (!PAGE_ID_RE.test(stripped)) {
    throw new Error(`Invalid Notion page id: "${id}" (must be 32 hex chars)`);
  }
  return stripped;
}

export type PageMarkdownResponse = {
  object: "page_markdown";
  id: string;
  markdown: string;
  truncated: boolean;
  unknown_block_ids: string[];
};

export async function fetchPageMarkdown(
  pageId: string,
): Promise<PageMarkdownResponse> {
  const id = normalizePageId(pageId);
  const res = await getNotionFetch()(`/v1/pages/${id}/markdown`);
  return (await res.json()) as PageMarkdownResponse;
}

export type PageIcon =
  | { type: "emoji"; emoji: string }
  | { type: "external"; external: { url: string } }
  | { type: "custom_emoji"; custom_emoji: { name: string } }
  | null;

export type PageMetaResponse = {
  object: "page";
  id: string;
  icon: PageIcon;
  properties: Record<string, unknown>;
  archived: boolean;
  in_trash: boolean;
  created_time: string;
  last_edited_time: string;
  url: string;
};

export async function fetchPageMeta(pageId: string): Promise<PageMetaResponse> {
  const id = normalizePageId(pageId);
  const res = await getNotionFetch()(`/v1/pages/${id}`);
  return (await res.json()) as PageMetaResponse;
}

// Minimal block-response shape — only the fields the file-attachment resolver
// looks at. Block IDs include dashes (`043c90f2-2b63-...`); we don't normalize
// because the API accepts both forms.
export type ImageBlockResponse = {
  object: "block";
  id: string;
  type: "image";
  image: {
    type: "file" | "external";
    file?: { url: string; expiry_time: string };
    external?: { url: string };
    caption?: Array<{ plain_text: string }>;
  };
};

export async function fetchBlock(
  blockId: string,
): Promise<ImageBlockResponse | null> {
  // Block IDs in file:// URLs have dashes; the API accepts the dashed form.
  const res = await getNotionFetch()(`/v1/blocks/${blockId}`);
  return (await res.json()) as ImageBlockResponse;
}

export function extractTitle(page: PageMetaResponse): string {
  const titleProp = Object.values(page.properties).find(
    (p): p is { type: "title"; title: Array<{ plain_text: string }> } =>
      typeof p === "object" &&
      p !== null &&
      (p as { type?: string }).type === "title",
  );
  if (!titleProp) return "";
  return titleProp.title.map((t) => t.plain_text).join("");
}

export function extractIconString(page: PageMetaResponse): string | null {
  if (!page.icon) return null;
  switch (page.icon.type) {
    case "emoji":
      return page.icon.emoji;
    case "external":
      return `external:${page.icon.external.url}`;
    case "custom_emoji":
      return `custom:${page.icon.custom_emoji.name}`;
    default:
      return null;
  }
}
