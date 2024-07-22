import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en',
  title: "PGlite",
  description: "Lightweight WASM Postgres",
  appearance: 'force-dark',
  base: '/',
  cleanUrls: true,
  ignoreDeadLinks: 'localhostLinks',
  head: [
    ['link', {
      rel: 'icon',
      type: 'image/svg+xml',
      href: '/img/brand/icon-light.svg'
    }]
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: {
      dark: '/img/brand/logo.svg',
      light: '/img/brand/logo-light.svg'
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'About', link: '/docs/about' },
      { text: 'Docs', link: '/docs/' },
      { text: 'Extensions', link: '/extensions/' },
      { text: 'ElectricSQL', link: 'https://www.electric-sql.com' }
    ],
    sidebar: [
      {
        text: 'About',
        items: [
          { text: 'What is PGlite', link: '/docs/about' },
        ]
      },
      {
        text: 'Docs',
        items: [
          { text: 'Getting Started', link: '/docs/' },
          { text: 'PGlite API', link: '/docs/api' },
          { text: 'Live Queries', link: '/docs/live-queries' },
          { text: 'Filesystems', link: '/docs/filesystems' },
          { text: 'Framework Hooks', link: '/docs/framework-hooks' },
          { text: 'Multi-tab Worker', link: '/docs/multi-tab-worker' },
          { text: 'REPL Component', link: '/docs/repl' },
        ]
      },
      {
        text: 'Extensions',
        items: [
          { text: 'Extensions Catalog', link: '/extensions/' },
          { text: 'Extension Development', link: '/extensions/development' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Benchmarks', link: '/benchmarks.md' },
        ]
      }
    ],
    siteTitle: false,
    socialLinks: [
      { icon: 'discord', link: 'https://discord.electric-sql.com' },
      { icon: 'github', link: 'https://github.com/electric-sql/pglite' }
    ],
    footer: {
      message:
        'Dual-licensed under <a href="https://github.com/electric-sql/pglite/blob/main/LICENSE">Apache 2.0</a> and the <a href="https://github.com/electric-sql/pglite/blob/main/POSTGRES-LICENSE">PostgreSQL License</a>',
      copyright:
        '© <a href="https://electric-sql.com/">ElectricSQL</a>'
    }
  },
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: tag => tag.startsWith('pglite-')
      }
    }
  }
})
