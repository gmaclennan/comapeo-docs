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

export const NOTION_API_KEY = required("NOTION_API_KEY");

export const DATA_SOURCE_ID =
  process.env.DATA_SOURCE_ID && !process.env.DATA_SOURCE_ID.includes("your_")
    ? process.env.DATA_SOURCE_ID
    : undefined;

export const DATABASE_ID =
  process.env.DATABASE_ID && !process.env.DATABASE_ID.includes("your_")
    ? process.env.DATABASE_ID
    : undefined;

export const NOTION_VERSION = "2026-03-11";
