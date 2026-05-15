// Scan rendered page bodies for cross-page Markdown links of the form
// `[text](<pageId>.md)` and warn about any whose target isn't a ✅ page in
// the current tree.
//
// Per tree-publish-plan §4 (Validation step): fail-soft. Emit a warning
// per broken link; don't fail the pipeline. The orchestrator counts and
// summarises.

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
