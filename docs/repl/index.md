---
layout: page
sidebar: false
footer: false
pageClass: page-repl-playground
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
