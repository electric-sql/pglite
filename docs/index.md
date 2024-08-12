---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: 'PGlite'
  text: 'Embeddable Postgres'
  tagline: 'Run a full Postgres database locally in your app with reactivity and server sync'
  actions:
    - theme: brand
      text: Getting Started
      link: /docs/
    - theme: alt
      text: About
      link: /docs/about
    - theme: alt
      text: GitHub
      link: https://github.com/electric-sql/pglite
    - theme: alt
      text: Discord
      link: https://discord.com/channels/933657521581858818/1212676471588520006

features:
  - title: Lightweight
    details: A complete WASM build of Postgres that's under 3MB Gzipped.
  - title: Extendable
    details: Dynamic extension loading mechanism, including support for pgvector and PostGIS.
  - title: Reactive
    details: Built in support for data loading, synchronisation and live query primitives.
---

<script setup>
import { defineClientComponent } from 'vitepress'
import { VPHomeHero } from 'vitepress/theme'

const Repl = defineClientComponent(() => {
  return import('./components/Repl.vue')
})
</script>

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

<div class="row">
  <div class="postgres-new">
    <div class="info">
      <h3>Experience PGlite with <a href="https://postgres.new">postgres.new</a></h3>
      <p>
        Create and publish a Postgres database using AI<br>
        build on PGlite by <a href="https:/supabase.com">Supabase</a>
      </p>
    </div>
    <video controls>
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
