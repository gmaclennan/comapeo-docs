// Run the pipeline against tmpdirs and print what *would* change in the
// repo. The working tree is not modified for docs/, _redirects, history,
// or the canonical-slugs manifest.
//
// Images are an exception: they use the real `static/images/notion/`
// store because the cache is content-addressed (immutable hash keys) and
// re-downloading every image into a tmpdir each run would be slow and
// wasteful. New images downloaded during a dry-run can be reverted with
// `git checkout -- static/images/notion`.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.ts";
import { error, log } from "./logger.ts";
import { makeImageStore } from "./images.ts";
import { runExport } from "./index.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

const REAL_DOCS = join(REPO_ROOT, "docs");
const REAL_REDIRECTS = join(REPO_ROOT, "static", "_redirects");
const REAL_HISTORY = join(REPO_ROOT, "static", "redirect-history.json");
const REAL_MANIFEST = join(REPO_ROOT, ".canonical-slugs.json");

async function main(): Promise<void> {
  const argId = process.argv[2];
  const rootId = argId ?? env.notionRootPageId;
  if (!rootId) {
    error(
      "no root page id. Pass one as argv[2] or set NOTION_ROOT_PAGE_ID in .env",
    );
    process.exit(1);
  }

  const tmp = await mkdtemp(join(tmpdir(), "notion-dry-run-"));
  const tmpDocs = join(tmp, "docs");
  const tmpRedirects = join(tmp, "_redirects");
  const tmpHistory = join(tmp, "redirect-history.json");
  const tmpManifest = join(tmp, ".canonical-slugs.json");

  log(`Dry run in ${tmp} (working tree not modified)`);

  // Seed the redirect history so prior-slug aliases are preserved.
  // Without this, the dry-run output would always look like a "first sync".
  if (existsSync(REAL_HISTORY)) {
    await copyFile(REAL_HISTORY, tmpHistory);
  }

  try {
    await runExport({
      rootId,
      docsDir: tmpDocs,
      manifestPath: tmpManifest,
      redirectsPath: tmpRedirects,
      historyPath: tmpHistory,
      imageStore: makeImageStore(),
    });

    log("");
    log("=== docs/ diff ===");
    runDirDiff(REAL_DOCS, tmpDocs);

    log("");
    log("=== static/_redirects diff ===");
    runFileDiff(REAL_REDIRECTS, tmpRedirects);

    log("");
    log("=== static/redirect-history.json diff ===");
    runFileDiff(REAL_HISTORY, tmpHistory);

    log("");
    log("=== .canonical-slugs.json diff ===");
    runFileDiff(REAL_MANIFEST, tmpManifest);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function runDirDiff(a: string, b: string): void {
  const r = spawnSync("diff", ["-rN", "--brief", a, b], { encoding: "utf8" });
  if (!r.stdout) {
    log("(no changes)");
    return;
  }
  process.stdout.write(r.stdout);
}

function runFileDiff(a: string, b: string): void {
  if (!existsSync(a) && !existsSync(b)) {
    log("(both missing)");
    return;
  }
  if (!existsSync(a)) {
    log(`(repo file missing; pipeline produced ${b})`);
    return;
  }
  if (!existsSync(b)) {
    log(`(pipeline did not produce ${b}; repo has ${a})`);
    return;
  }
  const r = spawnSync("diff", ["-u", a, b], { encoding: "utf8" });
  if (!r.stdout) {
    log("(no changes)");
    return;
  }
  process.stdout.write(r.stdout);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
}
