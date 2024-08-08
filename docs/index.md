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
  .try-it-now {
    text-align: center;
    margin-top: 4rem;
  }

  .postgres-new {
    display: flex;
    flex-direction: row;
    background: var(--vp-c-bg-soft);
    border-radius: 12px;
    margin-top: 4rem;
  }

  .postgres-new > .info {
    padding: 24px;
    flex-grow: 1;
    text-align: center;
  }

  .postgres-new > .image {
    display: block;
    flex-shrink: 1;
    width: 70%;
  }

  .postgres-new > .image > img {
    margin: -4% 0 -6% 0;
  }

  .postgres-new h3 {
    margin: 0;
  }

  .postgres-new-btn {
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
</style>

<!-- <div class="postgres-new">
  <div class="info">
    <h3>Experience <a href="https://postgres.new">postgres.new</a></h3>
    <p>An AI Postgres assistant<br> built on PGlite.</p>
    <a class="postgres-new-btn" href="/docs/about">What would you like to create?</a>
  </div>
  <div class="image">
    <img src="./public/img/postgres-new.png">
  </div>
</div> -->

<div class="try-it-now">

### Try PGlite Now

This is a full PGlite Postgres running in your browser - it even includes pgvector!

</div>

<ClientOnly>
  <Repl />
</ClientOnly>
