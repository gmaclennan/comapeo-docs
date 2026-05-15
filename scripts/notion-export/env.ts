import dotenv from "dotenv";

dotenv.config({ override: true, quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.includes("your_")) {
    throw new Error(
      `Missing or placeholder env var: ${name}. Set it in .env at the repo root.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.includes("your_")) return fallback;
  return value;
}

export const NOTION_API_KEY = required("NOTION_API_KEY");

// Optional: when present, used as a default for `pnpm notion:walk` and the pipeline.
// When absent, an explicit page id must be passed as a CLI arg.
const rawRoot = process.env.NOTION_ROOT_PAGE_ID;
export const NOTION_ROOT_PAGE_ID: string | undefined =
  rawRoot && !rawRoot.includes("your_") ? rawRoot.replace(/-/g, "") : undefined;

export const NOTION_VERSION = optional("NOTION_VERSION", "2026-03-11");
