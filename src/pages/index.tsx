import type { ReactNode } from "react";
import { Redirect } from "@docusaurus/router";
import useBaseUrl from "@docusaurus/useBaseUrl";

// Redirects the site root to /docs/.
// Once the Notion root page is promoted to ✅ and the canonical-slug plugin
// gives it `slug: /`, this file can be deleted — Docusaurus will serve the
// root doc at `/docs/` natively.
export default function Home(): ReactNode {
  return <Redirect to={useBaseUrl("/docs/")} />;
}
