<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import '@electric-sql/pglite-repl/webcomponent'
import { defaultDarkThemeInit } from '@electric-sql/pglite-repl/webcomponent'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'

const pg = new PGlite({
  extensions: {
    vector,
  },
})
const repl = ref(null)

let stopAnimation = false
let isAnimating = false
let observer = null

let pausePromise
let resume

function createPausePromise() {
  pausePromise = new Promise((resolve) => {
    resume = resolve
  })
}

const rootStyle = window.getComputedStyle(document.body)
const codeStyles = Object.fromEntries(
  [
    '--vp-code-line-height',
    '--vp-code-font-size',
    '--vp-code-font-family',
    '--vp-code-block-bg',
    '--vp-code-line-highlight-color',
    '--vp-c-brand-1',
  ].map((prop) => [prop, rootStyle.getPropertyValue(prop)]),
)
const theme = defaultDarkThemeInit({
  settings: {
    fontFamily: codeStyles['--vp-code-font-family'],
    background: codeStyles['--vp-code-block-bg'],
    lineHighlight: codeStyles['--vp-code-line-highlight-color'],
    caret: codeStyles['--vp-c-brand-1'],
  },
})

watch(
  () => repl.value,
  async () => {
    if (repl.value && repl.value.shadowRoot) {
      let inputEl
      while (!inputEl) {
        inputEl = repl.value.shadowRoot.querySelector('.cm-content')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const replRootEl = repl.value.shadowRoot.querySelector('.PGliteRepl-root')
      replRootEl.setAttribute('style', `--PGliteRepl-font-size: 14px;`)

      const styleEl = document.createElement('style')
      styleEl.innerHTML = `
        .cm-cursor {
          border-left-width: 0.5em !important;
        }
        .cm-scroller {
          line-height: 1.4 !important;
        }
      `
      repl.value.shadowRoot.insertBefore(
        styleEl,
        repl.value.shadowRoot.firstChild,
      )

      inputEl.addEventListener('focus', () => {
        if (!stopAnimation) {
          stopAnimation = true
          inputEl.innerText = ''
        }
      })

      // Setup Intersection Observer to pause/resume animation based on full visibility
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.intersectionRatio === 1) {
              if (!isAnimating) {
                isAnimating = true
                if (resume) resume()
              }
            } else {
              isAnimating = false
              createPausePromise()
            }
          })
        },
        { threshold: 1.0 },
      )

      observer.observe(repl.value)
      createPausePromise() // Initialize pausePromise
      animateInput(inputEl)
    }
  },
)

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect()
  }
})

const queries = ['SELECT * FROM now();']

async function animateInput(inputEl) {
  await sleep(1000)
  for (const query of queries) {
    let value = ''
    for (const c of query) {
      value += c
      if (stopAnimation) {
        return
      }
      if (!isAnimating) {
        await pausePromise
      }
      inputEl.innerText = value
      await sleep(50)
    }
    dispatchEnterEvent(inputEl)
    await sleep(400)
  }
  inputEl.focus()
}

async function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

function dispatchEnterEvent(el) {
  const event = new KeyboardEvent('keydown', {
    code: 'Enter',
    key: 'Enter',
    charCode: 13,
    keyCode: 13,
    view: window,
    bubbles: true,
  })
  el.dispatchEvent(event)
}
</script>

<template>
  <pglite-repl
    ref="repl"
    class="repl"
    :pg="pg"
    :darkTheme="theme"
    theme="dark"
  />
</template>

<style scoped>
.repl {
  margin-top: 2rem;
  height: clamp(350px, 35vh, 450px);
  display: flex;
  align-items: stretch;
  border-radius: 12px;
  overflow: hidden;
  font-size: 1rem;
}
</style>
