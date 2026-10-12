// Scan rendered page bodies for cross-page Markdown links of the form
// `[text](<pageId>.md)` and rewrite any whose target isn't a ✅ page in
// the current tree to visible `data-notion-lint="broken-link"` spans.
//
// Per tree-publish-plan §4 (Validation step): fail-soft. The marker is
// the report — reviewers see it on the staging Cloudflare preview and
// `lint:content` greps for it on the promotion PR. A warn() is emitted
// per broken link so operators see them in the pipeline log too.

import { LINT_ATTRIBUTE, type BrokenLinkReason } from "./lint-markers.ts";
import { warn } from "./logger.ts";
import type { Pages } from "./walk-tree.ts";

const LINK_RE = /\[([^\]]*)\]\(([0-9a-f]{32})\.md(?:#[^)]*)?\)/g;

/**
 * Walk every ready page, rewrite broken cross-page refs to marker spans,
 * warn per broken link, and return the count of rewrites.
 */
export function markBrokenLinks(pages: Pages): number {
  let count = 0;
  for (const page of pages.values()) {
    if (!page.ready || !page.body) continue;
    page.body = page.body.replace(
      LINK_RE,
      (whole, _text: string, targetId: string) => {
        const target = pages.get(targetId);
        let reason: BrokenLinkReason | null = null;
        if (!target) reason = "target-not-in-tree";
        else if (!target.ready) reason = "target-not-ready";
        if (!reason) return whole;
        count += 1;
        warn(`broken link: "${page.title}" → ${targetId} (${reason})`);
        return `<span ${LINT_ATTRIBUTE}="broken-link" data-page="${page.id}" data-target="${targetId}" data-reason="${reason}">⚠️ broken link</span>`;
      },
    );
  }
  return count;
}
