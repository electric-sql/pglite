import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en',
  title: 'PGlite',
  description: 'Lightweight WASM Postgres',
  appearance: 'force-dark',
  base: '/',
  cleanUrls: true,
  ignoreDeadLinks: [
    (url) => {
      // Ignore links to our example pages
      return url.toLowerCase().startsWith('./examples')
    },
    (url) => {
      // Ignore links to the benchmark runners
      return url.toLowerCase().startsWith('./benchmark/')
    },
  ],
  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/img/favicons/favicon-16x16.png',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/img/favicons/favicon-32x32.png',
      },
    ],
    [
      'link',
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/img/favicons/apple-touch-icon.png',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/img/brand/icon-light.svg',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: '/img/brand/og-image.png',
      },
    ],
    [
      'script',
      {
        defer: 'defer',
        'data-domain': 'pglite.dev',
        src: 'https://plausible.io/js/script.js',
      },
    ],
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: {
      dark: '/img/brand/logo.svg',
      light: '/img/brand/logo-light.svg',
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'About', link: '/docs/about' },
      { text: 'Docs', link: '/docs/' },
      { text: 'REPL', link: '/repl/' },
      { text: 'ElectricSQL', link: 'https://www.electric-sql.com' },
      {
        text: 'Star on GitHub',
        link: 'https://github.com/electric-sql/pglite',
      },
    ],
    sidebar: [
      {
        text: 'About',
        items: [{ text: 'What is PGlite', link: '/docs/about' }],
      },
      {
        text: 'Docs',
        items: [
          { text: 'Getting Started', link: '/docs/' },
          { text: 'PGlite API', link: '/docs/api' },
          { text: 'Live Queries', link: '/docs/live-queries' },
          { text: 'Filesystems', link: '/docs/filesystems' },
          {
            text: 'Framework Hooks',
            link: '/react',
            base: '/docs/framework-hooks',
            collapsed: false,
            items: [
              { text: 'React', link: '/react' },
              { text: 'Vue', link: '/vue' },
            ],
          },
          { text: 'Bundler Support', link: '/docs/bundler-support' },
          { text: 'Multi-tab Worker', link: '/docs/multi-tab-worker' },
          { text: 'REPL Component', link: '/docs/repl' },
          { text: 'ORMs & Query Builders', link: '/docs/orm-support' },
          { text: 'Sync using ElectricSQL', link: '/docs/sync' },
          { text: 'Upgrade v0.2.x -> v0.3.x', link: '/docs/upgrade' },
        ],
      },
      {
        text: 'Extensions',
        items: [
          { text: 'Extensions Catalog', link: '/extensions/' },
          { text: 'Extension Development', link: '/extensions/development' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Examples', link: '/examples.md' },
          { text: 'Benchmarks', link: '/benchmarks.md' },
        ],
      },
    ],
    siteTitle: false,
    socialLinks: [
      { icon: 'discord', link: 'https://discord.electric-sql.com' },
      { icon: 'github', link: 'https://github.com/electric-sql/pglite' },
    ],
    footer: {
      message:
        'Dual-licensed under <a href="https://github.com/electric-sql/pglite/blob/main/LICENSE">Apache 2.0</a> and the <a href="https://github.com/electric-sql/pglite/blob/main/POSTGRES-LICENSE">PostgreSQL License</a>',
      copyright: '© <a href="https://electric-sql.com/">ElectricSQL</a>',
    },
    search: {
      provider: 'local',
    },
  },
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag.startsWith('pglite-'),
      },
    },
  },
})
