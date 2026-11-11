import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const REPO = 'https://github.com/sergiodm92/nestjs-telemetry';

const config: Config = {
  title: 'NestJS Telemetry',
  tagline: 'A zero-configuration, real-time debugging dashboard for NestJS applications',
  favicon: 'img/favicon.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // GitHub Pages: https://sergiodm92.github.io/nestjs-telemetry/
  url: 'https://sergiodm92.github.io',
  baseUrl: '/nestjs-telemetry/',
  organizationName: 'sergiodm92',
  projectName: 'nestjs-telemetry',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  markdown: {
    // .md files are plain CommonMark (no JSX surprises); .mdx files may use components.
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${REPO}/tree/main/website/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: true,
      },
    },
    navbar: {
      title: 'NestJS Telemetry',
      logo: {
        alt: 'NestJS Telemetry',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {to: '/docs/watchers/overview', label: 'Watchers', position: 'left'},
        {to: '/docs/reference/rest-api', label: 'API', position: 'left'},
        {
          href: 'https://www.npmjs.com/package/@nestjs-telemetry/core',
          label: 'npm',
          position: 'right',
        },
        {
          href: REPO,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Introduction', to: '/docs/intro'},
            {label: 'Quick start', to: '/docs/getting-started/quick-start'},
            {label: 'Configuration', to: '/docs/configuration/options'},
            {label: 'Troubleshooting', to: '/docs/guides/troubleshooting'},
          ],
        },
        {
          title: 'Packages',
          items: [
            {label: '@nestjs-telemetry/core', href: 'https://www.npmjs.com/package/@nestjs-telemetry/core'},
            {label: '@nestjs-telemetry/typeorm', href: 'https://www.npmjs.com/package/@nestjs-telemetry/typeorm'},
            {label: '@nestjs-telemetry/prisma', href: 'https://www.npmjs.com/package/@nestjs-telemetry/prisma'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: REPO},
            {label: 'Issues', href: `${REPO}/issues`},
            {label: 'Contributing', to: '/docs/contributing'},
            {label: 'Changelog', to: '/docs/changelog'},
          ],
        },
      ],
      copyright: `MIT licensed. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'sql', 'diff'],
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
