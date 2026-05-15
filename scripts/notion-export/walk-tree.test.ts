import { describe, expect, it } from "vitest";
import { extractChildIds, extractMentionIds } from "./parse.ts";

const ID_A = "00112233445566778899aabbccddeeff";
const ID_B = "112233445566778899aabbccddeeff00";
const ID_C = "223344556677889900aabbccddeeff11";

describe("extractChildIds", () => {
  it("returns [] when there are no <page> tags", () => {
    expect(extractChildIds("# Just a heading\n\nParagraph.")).toEqual([]);
  });

  it("extracts a single self-closing <page url=.../> tag", () => {
    const md = `Some intro\n\n<page url="https://www.notion.so/${ID_A}"/>\n\nAfter`;
    expect(extractChildIds(md)).toEqual([ID_A]);
  });

  it("extracts a <page url=...>...</page> tag with inner content", () => {
    const md = `<page url="https://www.notion.so/${ID_A}">Some title</page>`;
    expect(extractChildIds(md)).toEqual([ID_A]);
  });

  it("preserves order across multiple tags", () => {
    const md = [
      `<page url="https://www.notion.so/${ID_A}"/>`,
      `<page url="https://www.notion.so/${ID_B}"/>`,
      `<page url="https://www.notion.so/${ID_C}"/>`,
    ].join("\n");
    expect(extractChildIds(md)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("deduplicates repeated page references", () => {
    const md = [
      `<page url="https://www.notion.so/${ID_A}"/>`,
      `<page url="https://www.notion.so/${ID_B}"/>`,
      `<page url="https://www.notion.so/${ID_A}"/>`,
    ].join("\n");
    expect(extractChildIds(md)).toEqual([ID_A, ID_B]);
  });

  it("handles <page url=... color=...>...</page> with color attribute", () => {
    const md = `<page url="https://www.notion.so/${ID_A}" color="blue">Title</page>`;
    expect(extractChildIds(md)).toEqual([ID_A]);
  });

  it("ignores <mention-page> tags (those are not children)", () => {
    const md = `<mention-page url="https://www.notion.so/${ID_A}"/>`;
    expect(extractChildIds(md)).toEqual([]);
  });

  it("ignores URLs that aren't 32-hex page ids", () => {
    const md = `<page url="https://www.notion.so/abc"/>`;
    expect(extractChildIds(md)).toEqual([]);
  });
});

describe("extractMentionIds", () => {
  it("extracts a single <mention-page url=.../>", () => {
    const md = `See <mention-page url="https://www.notion.so/${ID_A}"/> for details`;
    expect(extractMentionIds(md)).toEqual([ID_A]);
  });

  it("returns [] when there are no mention tags", () => {
    expect(extractMentionIds("Just text")).toEqual([]);
  });

  it("deduplicates repeated mentions", () => {
    const md = [
      `<mention-page url="https://www.notion.so/${ID_A}"/>`,
      `<mention-page url="https://www.notion.so/${ID_B}"/>`,
      `<mention-page url="https://www.notion.so/${ID_A}"/>`,
    ].join(" ");
    expect(extractMentionIds(md).sort()).toEqual([ID_A, ID_B].sort());
  });

  it("does not pick up <page> tags as mentions", () => {
    const md = `<page url="https://www.notion.so/${ID_A}"/>`;
    expect(extractMentionIds(md)).toEqual([]);
  });
});
