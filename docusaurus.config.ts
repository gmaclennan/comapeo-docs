import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import dotenv from "dotenv";
import { parseFrontMatterWithSlug } from "./src/plugins/canonical-slugs/parse-frontmatter";

dotenv.config();

// Production allows indexing; staging/preview does not.
const isProduction = process.env.IS_PRODUCTION === "true";

const config: Config = {
  title: "Comapeo Documentation",
  tagline: "Learn how to use the CoMapeo platform",
  favicon: "img/favicon.ico",

  // Opt in to upcoming Docusaurus v4 breaking changes (Rspack + SWC + LightningCSS
  // by default, strict MDX, namespaced localStorage). See
  // https://docusaurus.io/blog/releases/3.10.
  future: {
    v4: true,
  },

  url: "https://docs.comapeo.app",
  baseUrl: process.env.BASE_URL || "/",

  organizationName: "awana-digital",
  projectName: "comapeo-docs",

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      // Notion content occasionally has empty ![]() image references from
      // deleted attachments. Warn rather than fail the build.
      onBrokenMarkdownLinks: "warn",
      onBrokenMarkdownImages: "warn",
    },
    // Canonical-slug injection: reads `.canonical-slugs.json` (written by
    // the notion-export pipeline) and adds `slug: /<...>-<pageId>` to each
    // doc's frontmatter before the docs plugin resolves routes.
    parseFrontMatter: parseFrontMatterWithSlug,
  },

  // Prevent search engines from indexing staging/preview builds.
  noIndex: !isProduction,

  i18n: {
    defaultLocale: "en",
    locales: ["en", "pt", "es"],
    localeConfigs: {
      en: { label: "English", htmlLang: "en-US" },
      pt: { label: "Português", htmlLang: "pt-BR" },
      es: { label: "Español", htmlLang: "es-ES" },
    },
  },

  plugins: [
    // @docusaurus/plugin-client-redirects: removed in Sprint B.
    // The legacy /docs fallback redirect is gone; Sprint D's pipeline will
    // emit `static/_redirects` for bare-ID + prior-slug aliases.
    [
      "@docusaurus/plugin-pwa",
      {
        debug: true,
        offlineModeActivationStrategies: [
          "appInstalled",
          "standalone",
          "queryString",
        ],
        pwaHead: [
          { tagName: "link", rel: "icon", href: "/img/comapeo.png" },
          { tagName: "link", rel: "manifest", href: "/manifest.json" },
          { tagName: "meta", name: "theme-color", content: "#050F77" },
        ],
      },
    ],
    // @docusaurus/plugin-ideal-image removed: pulls in `sharp`, whose native
    // install scripts are denied by pnpm-workspace.yaml's supply-chain policy.
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          path: "docs",
          sidebarPath: "./src/components/sidebars.ts",
          // Editing happens in Notion, not GitHub — `editUrl` is omitted so
          // the "Edit this page" link is not rendered. Slugs are injected
          // by the canonical-slug hook (markdown.parseFrontMatter above).
        },
        theme: { customCss: "./src/css/custom.css" },
        sitemap: isProduction
          ? {
              lastmod: "date",
              changefreq: "weekly",
              priority: 0.5,
              ignorePatterns: ["/tags/**"],
              filename: "sitemap.xml",
            }
          : false,
      } satisfies Preset.Options,
    ],
  ],

  clientModules: [require.resolve("./src/client/scroll-to-top.ts")],

  themeConfig: {
    image: "img/comapeo-social-card.jpg",
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
    navbar: {
      logo: {
        alt: "CoMapeo",
        src: "img/comapeo_icon.png",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Documentation",
        },
        { type: "localeDropdown", position: "right" },
        {
          href: "https://github.com/digidem/comapeo-docs",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Awana Digital",
          items: [
            { label: "Website", href: "https://awana.digital" },
            { label: "Discord", href: "https://discord.gg/NtZgtAjj" },
            {
              label: "Bluesky",
              href: "https://bsky.app/profile/awana.digital",
            },
            { label: "Blog", href: "https://awana.digital/blog" },
          ],
        },
        {
          title: "CoMapeo",
          items: [
            { label: "Website", href: "https://comapeo.app" },
            {
              label: "CoMapeo Mobile GitHub",
              href: "https://github.com/digidem/comapeo-mobile",
            },
            {
              label: "CoMapeo Desktop GitHub",
              href: "https://github.com/digidem/comapeo-desktop",
            },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "PlayStore",
              href: "https://play.google.com/store/apps/details?id=com.comapeo",
            },
            {
              label: "GitHub",
              href: "https://github.com/digidem/comapeo-docs",
            },
            {
              label: "Earth Defenders Toolkit",
              href: "https://www.earthdefenderstoolkit.com/",
            },
          ],
        },
      ],
      copyright: `Made with ❤️ by Awana Digital - ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
