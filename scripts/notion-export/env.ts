// Lazy env access — reads happen at the system boundary (first Notion
// fetch, CLI argv parsing) rather than at module import. Tests that mock
// the pipeline never trip the assertion.
//
// Loading .env: callers should pass `node --env-file-if-exists=.env ...`
// (built into Node 22+). The pnpm `notion:walk` / `notion:export` scripts
// already do this.

function read(name: string): string | undefined {
  return process.env[name];
}

function required(name: string): string {
  const v = read(name);
  if (!v) {
    throw new Error(
      `Missing env var: ${name}. Set it in .env at the repo root or pass it directly.`,
    );
  }
  return v;
}

export const env = {
  get notionApiKey(): string {
    return required("NOTION_API_KEY");
  },
  /** 32-hex pageId (dashes stripped) when set; otherwise undefined. */
  get notionRootPageId(): string | undefined {
    const raw = read("NOTION_ROOT_PAGE_ID");
    return raw ? raw.replace(/-/g, "") : undefined;
  },
  get notionVersion(): string {
    return read("NOTION_VERSION") ?? "2026-03-11";
  },
};
