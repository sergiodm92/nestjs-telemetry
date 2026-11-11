import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/async-configuration',
      ],
    },
    {
      type: 'category',
      label: 'Configuration',
      items: [
        'configuration/options',
        'configuration/storage',
        'configuration/watchers',
        'configuration/global-prefix',
        'configuration/security',
      ],
    },
    {
      type: 'category',
      label: 'Watchers',
      link: {type: 'doc', id: 'watchers/overview'},
      items: [
        'watchers/requests',
        'watchers/exceptions',
        'watchers/logs',
        'watchers/schedules',
        'watchers/cache',
        'watchers/events',
        'watchers/mail',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: ['integrations/typeorm', 'integrations/prisma'],
    },
    {
      type: 'category',
      label: 'Dashboard',
      items: ['dashboard/overview', 'dashboard/embedding'],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/batch-correlation',
        'concepts/entry-model',
        'concepts/data-masking',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/rest-api', 'reference/public-api', 'reference/custom-storage'],
    },
    {
      type: 'category',
      label: 'Guides',
      items: ['guides/production', 'guides/testing', 'guides/troubleshooting'],
    },
    'contributing',
    'changelog',
  ],
};

export default sidebars;
