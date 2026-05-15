import {
  pipeline,
  withBaseUrl,
  withHeaders,
  withHttpError,
  withRateLimit,
  withRetry,
} from "fetch-extras";
import { NOTION_API_KEY, NOTION_VERSION } from "./env.ts";

const NOTION_RATE_LIMIT_RPS = 3;

const notionFetch = pipeline(
  fetch,
  withBaseUrl("https://api.notion.com"),
  withHeaders({
    Authorization: `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  }),
  withRateLimit({
    requestsPerInterval: NOTION_RATE_LIMIT_RPS,
    interval: 1000,
  }),
  withRetry({ retries: 3 }),
  withHttpError(),
);

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
  const res = await notionFetch(`/v1/pages/${id}/markdown`);
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
  const res = await notionFetch(`/v1/pages/${id}`);
  return (await res.json()) as PageMetaResponse;
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
