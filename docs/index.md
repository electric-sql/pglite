---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: 'PGlite'
  text: 'Embeddable Postgres'
  tagline: 'Run a full Postgres database locally in WASM with reactivity and live sync.'
  actions:
    - theme: brand
      text: Get Started
      link: /docs/
    - theme: alt
      text: Star on GitHub
      link: https://github.com/electric-sql/pglite
    - theme: alt
      text: Get from NPM
      link: https://www.npmjs.com/package/@electric-sql/pglite

features:
  - title: Lightweight
    details: A complete WASM build of Postgres that's under 3MB Gzipped.
  - title: Extendable
    details: Dynamic extension loading mechanism, including support for pgvector and PostGIS.
  - title: Reactive
    details: Built in support for data loading, synchronisation and live query primitives.
---

<script setup>
import { onMounted } from 'vue'
import { defineClientComponent } from 'vitepress'
import { VPHomeHero } from 'vitepress/theme'
import { data as initialStarCount } from './count.data.ts'
import { data as initialDownloadCount } from './downloadCount.data.ts'
import { starCount, downloadCount } from './components/starCount.ts'

const Repl = defineClientComponent(() => {
  return import('./components/Repl.vue')
})

function toShortDecimal(x) {
  return x.toLocaleString('en-US', {
      // add suffixes for thousands, millions, and billions
      // the maximum number of decimal places to use
      maximumFractionDigits: 1,
      // specify the abbreviations to use for the suffixes
      notation: 'compact',
      compactDisplay: 'short'
    });
}

async function renderGitHub() {
  const linkEl = document.querySelector('.action a[href="https://github.com/electric-sql/pglite"]')
  let countEl = linkEl.querySelector('.count')
    
  if (!countEl) {
    countEl = document.createElement('span')
    countEl.classList.add('count')
    countEl.innerText = `(${toShortDecimal(initialStarCount)})`;

    const icon = document.createElement('span')
    icon.classList.add('vpi-social-github')
    linkEl.prepend(icon)

    Array.from(linkEl.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      .forEach(n => {
        const span = document.createElement('span')
        span.classList.add('action-text')
        span.textContent = n.textContent
        n.replaceWith(span)
      })
  }
    
  linkEl.append(countEl)

  const count = await starCount(initialStarCount)

  let currentCount = Math.max(count - 15, initialStarCount)
  const animateCount = () => {
    currentCount += 1;
    if (currentCount >= count) {
      currentCount = count;
      clearInterval(intervalId);
    }

    countEl.innerText = `(${toShortDecimal(currentCount)})`;
  };
  const intervalId = setInterval(animateCount, 64);
}

async function renderNpmJs() {
  const linkEl = document.querySelector('.action a[href="https://www.npmjs.com/package/@electric-sql/pglite"]')
  let countEl = linkEl.querySelector('.count')
    
  if (!countEl) {
    countEl = document.createElement('span')
    countEl.classList.add('count')
    countEl.innerText = `(${toShortDecimal(initialDownloadCount)})`;

    const icon = document.createElement('span')
    icon.classList.add('vpi-social-npm')
    linkEl.prepend(icon)

    Array.from(linkEl.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      .forEach(n => {
        const span = document.createElement('span')
        span.classList.add('action-text')
        span.textContent = n.textContent
        n.replaceWith(span)
      })
  }
    
  linkEl.append(countEl)

  const count = await downloadCount(initialDownloadCount)

  let currentCount = Math.max(count - 15, initialDownloadCount)
  const animateCount = () => {
    currentCount += 1;
    if (currentCount >= count) {
      currentCount = count;
      clearInterval(intervalId);
    }

    countEl.innerText = `(${toShortDecimal(currentCount)})`;
  };
  const intervalId = setInterval(animateCount, 64);
}

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    renderGitHub()
    renderNpmJs()
  }
});

</script>

<style>
  .actions a[href="https://github.com/electric-sql/pglite"] {
    display: flex;
    align-items: center;
  }
  .actions a[href="https://www.npmjs.com/package/@electric-sql/pglite"] {
    display: flex;
    align-items: center;
  }
  .actions a[href="https://github.com/electric-sql/pglite"] .vpi-social-github {
    display: block;
    width: 1.22rem;
    height: 1.22rem;
    margin: 0 0.3rem 0 0;
    position: relative;
  }
  .actions a[href="https://www.npmjs.com/package/@electric-sql/pglite"] .vpi-social-npm {
    display: block;
    width: 1.22rem;
    height: 1.22rem;
    margin: 0 0.3rem 0 0;
    position: relative;
  }  
  .actions a[href="https://github.com/electric-sql/pglite"] .count {
    margin-left: 0.25rem;
    min-width: 45px;
  }
  .actions a[href="https://www.npmjs.com/package/@electric-sql/pglite"] .count {
    margin-left: 0.25rem;
    min-width: 45px;
  }

  @media (max-width: 575px) {
    .actions .action-text {
      display: none;
    }
    .actions {
      flex-wrap: nowrap !important;
      gap: 6px !important;
    }
    .actions .action .VPButton {
      padding: 0 12px !important;
      font-size: 13px !important;
    }
    .actions a[href="https://github.com/electric-sql/pglite"] .count,
    .actions a[href="https://www.npmjs.com/package/@electric-sql/pglite"] .count {
      margin-left: 0.15rem;
      min-width: auto;
    }
  }
</style>

<style scoped>

  .try-it-now,
  .postgres-new {
    margin-top: 3rem;
    display: flex;
    flex-direction: column;
  }

  .try-it-now .repl {
    display: block;
    width: 100%;
    margin-bottom: 1rem;
    height: 350px;
  }

  .info {
    text-align: center;
  }

  .postgres-new video {
    display: block;
    width: 100%;
    border-radius: 12px;
    margin-bottom: 1rem;
    aspect-ratio: 1616 / 1080;
  }

  .link-btn {
    border-color: var(--vp-button-alt-border);
    color: var(--vp-button-alt-text);
    background-color: var(--vp-button-alt-bg);
    border-radius: 20px;
    padding: 0 20px;
    line-height: 38px;
    font-size: 14.5px;
    display: inline-block;
    border: 1px solid transparent;
    text-align: center;
    font-weight: 600;
    white-space: nowrap;
    transition: color 0.25s, border-color 0.25s, background-color 0.25s;
    text-decoration: none;
  }

  @media (min-width: 1000px) {
    .row {
      display: flex;
    }

    .try-it-now,
    .postgres-new {
      width: 50%;
    }

    .try-it-now {
      padding-left: 1rem;
    }

    .postgres-new {
      padding-right: 1rem;
    }

    .try-it-now .repl {
      height: auto;
      aspect-ratio: 1616 / 1080;
    }
  }
</style>

<span class="vpi-social-github"></span>

<div class="row">
  <div class="postgres-new">
    <div class="info">
      <h3>Experience PGlite with <a href="https://database.build">database.build</a></h3>
      <p>
        Create and publish a Postgres database using AI
        <br class="hide-xs" />
        built on PGlite by <a href="https://supabase.com">Supabase</a>:
      </p>
    </div>
    <video controls poster="https://static.pglite.dev/videos/postgres-new-showcase-loop.png">
      <source src="https://static.pglite.dev/videos/postgres-new-showcase-loop-1080p.mp4" type="video/mp4" />
    </video>
    <a class="link-btn" href="https://database.build">
      What would you like to create?</a>
  </div>
  <div class="try-it-now">
    <div class="info">
      <h3>Try PGlite Now</h3>
      <p>
        This is a full PGlite Postgres running in your browser.
        <br class="hide-xs" />
        It even includes <a href="/extensions/#pgvector">pgvector</a>!
      </p>
    </div>
    <ClientOnly>
      <Repl class="repl" />
    </ClientOnly>
    <a class="link-btn" href="/repl">
      Try more extensions in the playground</a>
  </div>
</div>
