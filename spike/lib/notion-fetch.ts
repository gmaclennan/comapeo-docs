import { NOTION_API_KEY, NOTION_VERSION } from "./env";

const BASE = "https://api.notion.com/v1";

type FetchInit = {
  method?: "GET" | "POST";
  body?: unknown;
};

async function notionFetch<T>(path: string, init: FetchInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status} ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

export type PageMarkdownResponse = {
  object: "page_markdown";
  id: string;
  markdown: string;
  truncated: boolean;
  unknown_block_ids: string[];
};

export async function fetchPageMarkdown(
  pageId: string
): Promise<PageMarkdownResponse> {
  return notionFetch<PageMarkdownResponse>(`/pages/${pageId}/markdown`);
}

export type NotionPage = {
  id: string;
  properties: Record<string, any>;
  url: string;
  created_time: string;
  last_edited_time: string;
};

type QueryResponse = {
  object: "list";
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
};

export async function queryDataSource(
  dataSourceId: string,
  body: Record<string, any> = {}
): Promise<QueryResponse> {
  return notionFetch<QueryResponse>(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body,
  });
}

export async function queryDatabase(
  databaseId: string,
  body: Record<string, any> = {}
): Promise<QueryResponse> {
  return notionFetch<QueryResponse>(`/databases/${databaseId}/query`, {
    method: "POST",
    body,
  });
}
