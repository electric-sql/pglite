<script setup>
import { ref, watch, onMounted, computed, toRaw, shallowRef } from 'vue'
import { defaultDarkThemeInit } from '@electric-sql/pglite-repl/webcomponent'
import { PGlite } from '@electric-sql/pglite'
import { data as extensionsData } from '../extensions/extensions.data.ts'
import * as allExtension from './allExtensions.ts'

const defaultExtensions = ['pgvector']

const enabledExtensions = ref(
  localStorage.getItem('enabledExtensions')
    ? JSON.parse(localStorage.getItem('enabledExtensions'))
    : defaultExtensions,
)
const loadedExtensions = ref([])

const pg = shallowRef()
const repl = ref(null)
const showOptions = ref(false)

watch(enabledExtensions, (value) => {
  localStorage.setItem('enabledExtensions', JSON.stringify(value))
})

const showReloadMsg = computed(() => {
  return (
    pg.value &&
    (enabledExtensions.value.some(
      (ext) => !loadedExtensions.value.includes(ext),
    ) ||
      loadedExtensions.value.some(
        (ext) => !enabledExtensions.value.includes(ext),
      ))
  )
})

async function loadPg() {
  const extensions = Object.fromEntries(
    enabledExtensions.value.map((extension) => {
      const { importName } = extensionsData.extensions.find(
        (ext) => ext.name === extension,
      )
      return [extension, allExtension[importName]]
    }),
  )

  loadedExtensions.value = [...enabledExtensions.value]
  pg.value = await PGlite.create({
    dataDir: 'idb://pglite-playground',
    extensions,
  })
}

onMounted(() => {
  loadPg()
})

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

const extensions = computed(() => {
  return extensionsData.extensions.filter((extension) =>
    extension.tags.includes('postgres extension'),
  )
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
      replRootEl.setAttribute('style', `--PGliteRepl-font-size: 14.5px;`)

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

      inputEl.focus()
    }
  },
)

async function clearDb() {
  if (pg.value) {
    await pg.value.close()
  }
  while (true) {
    const closed = await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('/pglite/pglite-playground')

      req.onsuccess = () => {
        resolve(true)
      }
      req.onerror = () => {
        reject(
          req.error
            ? req.error
            : 'An unknown error occurred when deleting IndexedDB database',
        )
      }
      req.onblocked = () => {
        resolve(false)
      }
    })
    if (closed) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await loadPg()
}
</script>

<template>
  <div class="repl-playground" :class="{ 'show-options': showOptions }">
    <div class="sidebar">
      <div class="top">
        <h1>PGlite Playground REPL</h1>
        <p>
          A REPL that you can use to try out PGlite with a database persisted in
          your browsers IndexedDB.
        </p>
        <p>
          <b>Tip:</b> The psql <code>\d[..]</code> commands are available, and
          there is autocomplete based on your schema.
        </p>
        <h2>Enabled Extensions</h2>
        <div
          v-for="extension in extensions"
          :key="extension.name"
          class="extension"
        >
          <input
            type="checkbox"
            :id="extension.name"
            :value="extension.name"
            v-model="enabledExtensions"
            :title="extension.shortDescription"
          />
          <label :for="extension.name" :title="extension.shortDescription">{{
            extension.name
          }}</label>
          <span v-if="extension.shortDescription">
            {{ extension.shortDescription }}
          </span>
        </div>
      </div>
      <div class="bottom">
        <button class="btn-clear" @click="clearDb()">
          Clear Playground Database
        </button>
      </div>
    </div>
    <div class="main" @click="showOptions = false">
      <div class="info-msg" v-if="showReloadMsg">
        Please <button @click="loadPg()">Restart</button> PGlite to enable the
        selected extensions.
      </div>
      <pglite-repl
        v-if="pg"
        ref="repl"
        class="repl"
        :pg="toRaw(pg)"
        :darkTheme="theme"
        theme="dark"
      />
      <div v-else class="loading">Loading...</div>
    </div>
  </div>

  <teleport to=".VPNavBar .content-body" v-if="pg">
    <button
      href="#repl-option"
      class="repl-option-link"
      :class="{ active: showOptions }"
      @click="showOptions = !showOptions"
    >
      REPL Options
    </button>
  </teleport>
</template>

<style>
:is(html, body):has(.page-repl-playground) {
  height: 100vh;
  overflow: hidden;
}

@media (max-width: 768px) {
  body:has(.page-repl-playground) {
    touch-action: none;
  }
}

.page-repl-playground .VPNav {
  position: fixed !important;
}

.page-repl-playground .VPContent {
  padding-top: var(--vp-nav-height) !important;
}

.page-repl-playground.Layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.page-repl-playground .VPContent,
.page-repl-playground .VPPage,
.page-repl-playground .VPPage > div,
.page-repl-playground .VPPage > div > div {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.page-repl-playground .VPPage,
.page-repl-playground .VPPage > div,
.page-repl-playground .VPPage > div > div {
  flex-grow: 1;
}
</style>

<style scoped>
.repl-playground {
  display: flex;
  flex-direction: row;
  height: 100%;
  max-height: 100%;
  flex-grow: 1;
}

.sidebar {
  width: 300px;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  font-size: 14.5px;
}

.sidebar .top {
  padding: 1rem;
  border-bottom: 1px solid #000;
  height: 100%;
  overflow-y: auto;
}

.sidebar .bottom {
  padding: 14.5px 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
}

.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  background-color: rgb(22, 22, 24);
}

.info-msg {
  background-color: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  padding: 0.25rem 0.5rem;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 14.5px;
}

.info-msg button {
  background-color: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  border: none;
  padding: 0.25rem 0.5rem;
  margin: 0 0.25rem;
  cursor: pointer;
  border-radius: 0.25rem;
  font-size: 14.5px;
  transition:
    color 0.25s,
    border-color 0.25s,
    background-color 0.25s;
}

.info-msg button:hover {
  background-color: var(--vp-button-alt-bg);
}

.repl {
  flex: 1;
  max-height: 100%;
}

.btn-clear {
  border-color: var(--vp-button-alt-border);
  color: var(--vp-button-alt-text);
  background-color: var(--vp-button-alt-bg);
  padding: 0.25rem 1rem;
  border-radius: 0.25rem;
  transition:
    color 0.25s,
    border-color 0.25s,
    background-color 0.25s;
  font-size: 14.5px;
}

.btn-clear:hover {
  border-color: var(--vp-button-alt-hover-border);
  background-color: var(--vp-button-alt-hover-bg);
}

h1,
h2 {
  font-weight: bold;
  font-size: 14.5px;
}

h1 {
  margin-bottom: 0.5rem;
  color: var(--vp-c-brand-1);
}

h2 {
  margin-top: 1rem;
}

p {
  font-size: 14.5px;
  margin: 0.5rem 0;
}

p code {
  background-color: #000;
  color: var(--vp-c-brand-1);
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
}

.extension {
  display: flex;
  align-items: center;
  margin: 0.25rem 0;
}

.extension input {
  margin-right: 0.5rem;
  accent-color: var(--vp-c-brand-1);
}

.extension label {
  white-space: nowrap;
}

.extension span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 0.5rem;
  opacity: 0.3;
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  font-size: 14.5px;
  opacity: 0.5;
}

.repl-option-link {
  display: none;
}
.repl-option-link:hover,
.repl-option-link.active {
  color: var(--vp-c-brand-1);
}

@media (max-width: 768px) {
  .repl-option-link {
    order: -1;
    display: flex;
    align-items: center;
    padding: 0 12px;
    line-height: var(--vp-nav-height);
    font-size: 14.5px;
    font-weight: 500;
    color: var(--vp-c-text-1);
    transition: color 0.25s;
  }
  .sidebar {
    width: 300px;
  }
  .main {
    width: 100vw;
  }
  .repl-playground {
    width: calc(100vw + 300px);
    position: relative;
    left: -300px;
    transition: transform 0.15s ease;
  }
  .repl-playground.show-options {
    transform: translateX(300px);
  }
}
</style>
