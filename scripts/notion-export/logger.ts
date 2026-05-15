const PREFIX = "[notion-export]";

export const VERBOSE = process.argv.includes("--verbose") || process.env.VERBOSE === "true";

export function log(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}

export function debug(...args: unknown[]): void {
  if (VERBOSE) console.log(PREFIX, "[debug]", ...args);
}
