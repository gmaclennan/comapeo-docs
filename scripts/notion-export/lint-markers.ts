// Single source of truth for the `data-notion-lint` marker contract.
//
// The export pipeline emits markers; `lint.ts` and `src/plugins/notion-lint`
// detect them. All three sides import from here so a typo or renamed
// category breaks the build/tests instead of silently disappearing from
// detection.

export const LINT_MARKER_CATEGORIES = [
  "broken-link",
  "missing-image",
  "truncated",
  "custom-emoji",
] as const;

export type LintMarkerCategory = (typeof LINT_MARKER_CATEGORIES)[number];

/** Sub-categories carried in `data-category="..."` on missing-image markers. */
export const MISSING_IMAGE_SUBCATEGORIES = [
  "fetch-failed",
  "file-unresolved",
  "bare-filename",
] as const;

export type MissingImageSubcategory =
  (typeof MISSING_IMAGE_SUBCATEGORIES)[number];

/** Reasons carried in `data-reason="..."` on broken-link markers. */
export const BROKEN_LINK_REASONS = [
  "target-not-in-tree",
  "target-not-ready",
] as const;

export type BrokenLinkReason = (typeof BROKEN_LINK_REASONS)[number];

/** The attribute name itself. Keep in one place so the emitters, the
 *  remark stripper, and the lint regex all reference the same string. */
export const LINT_ATTRIBUTE = "data-notion-lint";
