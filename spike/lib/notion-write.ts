import { NOTION_API_KEY, NOTION_VERSION } from "./env";

const BASE = "https://api.notion.com/v1";

type Json = Record<string, any>;

async function api<T>(path: string, init: { method: "GET" | "POST" | "PATCH"; body?: Json } = { method: "GET" }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion API ${res.status} ${path}: ${text}`);
  return JSON.parse(text) as T;
}

export type CreatePageOpts = {
  parent: { type: "workspace"; workspace: true } | { type: "page_id"; page_id: string };
  title: string;
  icon?: string;
  markdown: string;
};

export async function createPageMarkdown(opts: CreatePageOpts): Promise<{ id: string; url: string }> {
  const body: Json = {
    parent: opts.parent.type === "workspace" ? { type: "workspace", workspace: true } : { type: "page_id", page_id: opts.parent.page_id },
    properties: {
      title: { title: [{ type: "text", text: { content: opts.title } }] },
    },
    markdown: opts.markdown,
  };
  if (opts.icon) {
    body.icon = { type: "emoji", emoji: opts.icon };
  }
  const res = await api<{ id: string; url: string }>("/pages", { method: "POST", body });
  return { id: res.id, url: res.url };
}

export async function patchPageMarkdown(pageId: string, oldStr: string, newStr: string, replaceAll = false): Promise<void> {
  await api(`/pages/${pageId}/markdown`, {
    method: "PATCH",
    body: {
      type: "update_content",
      update_content: {
        content_updates: [{ old_str: oldStr, new_str: newStr, replace_all_matches: replaceAll }],
      },
    },
  });
}

export async function replacePageMarkdown(pageId: string, newStr: string, allowDeletingContent = false): Promise<void> {
  await api(`/pages/${pageId}/markdown`, {
    method: "PATCH",
    body: {
      type: "replace_content",
      replace_content: {
        new_str: newStr,
        ...(allowDeletingContent ? { allow_deleting_content: true } : {}),
      },
    },
  });
}
