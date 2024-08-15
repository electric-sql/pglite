---
layout: page
sidebar: false
footer: false
pageClass: page-repl-playground
head:
  - - meta
    - name: viewport
      content: width=device-width, initial-scale=1, interactive-widget=resizes-content
---

<script setup>
import { defineClientComponent } from 'vitepress'

const ReplPlayground = defineClientComponent(() => {
  return import('./ReplPlayground.vue')
})
</script>

<ClientOnly>
  <ReplPlayground />
</ClientOnly>
