---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: 'PGlite'
  text: 'Embeddable Postgres'
  tagline: 'Run a full Postgres database locally in your app with reactivity and server sync'
  actions:
    - theme: brand
      text: Get Started
      link: /docs/
    - theme: alt
      text: Star on GitHub
      link: https://github.com/electric-sql/pglite

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
import { starCount } from './components/starCount.ts'

const Repl = defineClientComponent(() => {
  return import('./components/Repl.vue')
})

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    const linkEl = document.querySelector('.action a[href="https://github.com/electric-sql/pglite"]')
    let countEl = linkEl.querySelector('.count')
    
    if (!countEl) {
      countEl = document.createElement('span')
      countEl.classList.add('count')
      countEl.innerText = `( ${initialStarCount.toLocaleString()} )`;

      const icon = document.createElement('span')
      icon.classList.add('vpi-social-github')
      linkEl.prepend(icon)
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
      countEl.innerText = `( ${currentCount.toLocaleString()} )`;
    };
    const intervalId = setInterval(animateCount, 64);
  }
});

</script>

<style>
  .actions a[href="https://github.com/electric-sql/pglite"] {
    display: flex;
    align-items: center;
  }
  .actions a[href="https://github.com/electric-sql/pglite"] .vpi-social-github {
    display: block;
    width: 1.42rem;
    height: 1.42rem;
    margin: 0 0.5rem 0 0;
    position: relative;
  }
  .actions a[href="https://github.com/electric-sql/pglite"] .count {
    margin-left: 0.25rem;
    min-width: 55px;
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
    font-size: 14px;
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
      <h3>Experience PGlite with <a href="https://postgres.new">postgres.new</a></h3>
      <p>
        Create and publish a Postgres database using AI<br>
        build on PGlite by <a href="https:/supabase.com">Supabase</a>
      </p>
    </div>
    <video controls poster="https://static.pglite.dev/videos/postgres-new-showcase-loop.png">
      <source src="https://static.pglite.dev/videos/postgres-new-showcase-loop-1080p.mp4" type="video/mp4" />
    </video>
    <a class="link-btn" href="https://postgres.new">What would you like to create?</a>
  </div>
  <div class="try-it-now">
    <div class="info">
      <h3>Try PGlite Now</h3>
      <p>
        This is a full PGlite Postgres running in your browser<br>
        It even includes <a href="/extensions/#pgvector">pgvector</a>!</p>
    </div>
    <ClientOnly>
      <Repl class="repl" />
    </ClientOnly>
    <a class="link-btn" href="/repl">Try more extensions in the playground</a>
  </div>
</div>
