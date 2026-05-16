// Scan rendered page bodies for cross-page Markdown links of the form
// `[text](<pageId>.md)` and warn about any whose target isn't a ✅ page in
// the current tree.
//
// Per tree-publish-plan §4 (Validation step): fail-soft. Emit a warning
// per broken link; don't fail the pipeline. The orchestrator counts and
// summarises, and `applyBrokenLinkMarkers` rewrites each broken ref into
// a `data-notion-lint="broken-link"` span so reviewers see the failure on
// the staging preview.

import type { Pages } from "./walk-tree.ts";

const LINK_RE = /\[([^\]]*)\]\(([0-9a-f]{32})\.md(?:#[^)]*)?\)/g;

export type BrokenLink = {
  /** pageId of the source page (the one that contains the broken link). */
  sourcePageId: string;
  sourceTitle: string;
  /** pageId the link refers to. */
  targetPageId: string;
  /** Reason the link is broken. */
  reason: "target-not-in-tree" | "target-not-ready";
};

export function validateCrossPageLinks(pages: Pages): BrokenLink[] {
  const broken: BrokenLink[] = [];

  for (const page of pages.values()) {
    if (!page.ready || !page.body) continue;
    for (const match of page.body.matchAll(LINK_RE)) {
      const targetId = match[2];
      const target = pages.get(targetId);
      if (!target) {
        broken.push({
          sourcePageId: page.id,
          sourceTitle: page.title,
          targetPageId: targetId,
          reason: "target-not-in-tree",
        });
      } else if (!target.ready) {
        broken.push({
          sourcePageId: page.id,
          sourceTitle: page.title,
          targetPageId: targetId,
          reason: "target-not-ready",
        });
      }
    }
  }

  return broken;
}

/**
 * Rewrite each broken `[text](pageId.md)` reference in `page.body` to a
 * visible marker span. The lint workflow greps for `data-notion-lint=`
 * and fails the staging→published promotion PR if any are present; the
 * production Docusaurus build strips the markers via the notion-lint
 * remark plugin.
 *
 * `broken` is the report from `validateCrossPageLinks`; this function
 * uses it to drive an in-place rewrite. Targets not in `broken` keep
 * their normal markdown link.
 */
export function applyBrokenLinkMarkers(
  pages: Pages,
  broken: BrokenLink[],
): void {
  const reasonByPair = new Map<string, BrokenLink["reason"]>();
  for (const b of broken) {
    reasonByPair.set(`${b.sourcePageId}:${b.targetPageId}`, b.reason);
  }

  for (const page of pages.values()) {
    if (!page.body) continue;
    page.body = page.body.replace(LINK_RE, (whole, _text: string, targetId: string) => {
      const reason = reasonByPair.get(`${page.id}:${targetId}`);
      if (!reason) return whole;
      return `<span data-notion-lint="broken-link" data-target="${targetId}" data-reason="${reason}">⚠️ broken link</span>`;
    });
  }
}
