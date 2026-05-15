import data from "./output/english-pages.json";

console.log("=== TITLE rows (potential section landings) ===");
for (const p of (data as any[]).filter((x) => x.elementType === "Title")) {
  console.log(`  [${p.order}] section=${p.contentSection} title="${p.title}" id=${p.id}`);
}

console.log("\n=== TOGGLE rows ===");
for (const p of (data as any[]).filter((x) => x.elementType === "Toggle")) {
  console.log(
    `  [${p.order}] section=${p.contentSection} title="${p.title}" parent=${p.parentItem[0] ?? "(none)"} id=${p.id}`
  );
}

console.log("\n=== Pages without Content Section ===");
for (const p of (data as any[]).filter((x) => !x.contentSection)) {
  console.log(
    `  [${p.order}] type=${p.elementType} title="${p.title}" parent=${p.parentItem[0] ?? "(none)"} id=${p.id}`
  );
}

console.log("\n=== All pages grouped by section, sorted by order ===");
const bySection = new Map<string, any[]>();
for (const p of data as any[]) {
  const k = p.contentSection || "(NO SECTION)";
  if (!bySection.has(k)) bySection.set(k, []);
  bySection.get(k)!.push(p);
}
const sectionOrder = [
  "Overview",
  "Quick Start Guide",
  "Planning",
  "10-Preparing to use CoMapeo",
  "20-Gathering Observations & Tracks",
  "30-Reviewing Observations & Tracks",
  "40-Managing Data and Privacy",
  "50-Managing Projects",
  "60-Exchanging Observations",
  "70-Sharing and Exporting different data types",
  "80-Ending a project",
  "90+ - Miscellaneous",
  "(NO SECTION)",
];
for (const sec of sectionOrder) {
  const pages = bySection.get(sec);
  if (!pages || pages.length === 0) continue;
  console.log(`\n## ${sec}  (${pages.length} pages)`);
  pages.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  for (const p of pages) {
    const flag = ["Draft published", "Ready to publish", "Published"].includes(p.status)
      ? "✅"
      : "🚧";
    console.log(`  ${flag} [${String(p.order ?? "?").padStart(3)}] ${p.elementType.padEnd(7)} ${p.title}`);
  }
}
