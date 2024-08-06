<script setup>
import { computed, ref } from "vue";
import { data } from "./extensions.data.ts";

const filteredExtensions = computed(() => {
  return data.extensions
    .filter((ext) => !selectedTag.value || ext.tags.includes(selectedTag.value))
    .sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return a.name.localeCompare(b.name);
    });
});

function mainLink(ext) {
  return ext.homepage || ext.repo || ext.docs;
}

function slugify(string) {
  return string
    .replace('/', '')
    .replace(' ', '-')
    .replace('_', '-')
    .toLowerCase()
}

const tags = computed(() => {
  return data.tags.map((tag) => {
    return {
      name: tag,
      count: data.extensions.filter((ext) => ext.tags.includes(tag)).length,
    }
  })
})

const selectedTag = ref(null)
</script>

<style scoped>
.btn-tag {
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
    margin-right: 0.5rem;
}

.btn-tag:hover {
  border-color: var(--vp-button-alt-hover-border);
  color: var(--vp-button-alt-hover-text);
  background-color: var(--vp-button-alt-hover-bg);
}

.btn-tag.selected {
  border-color: var(--vp-button-brand-border);
  color: var(--vp-c-gray-3);
  background-color: var(--vp-button-brand-bg);
}

.btn-tag.selected:hover {
  border-color: var(--vp-button-brand-hover-border);
  background-color: var(--vp-button-brand-hover-bg);
}

.btn-tag .count {
  margin-left: 0.25rem;
  margin-left: 0.25rem;
  opacity: 0.5
}

.tags, .links {
  margin-top: 1rem;
}

.tag {
    border-color: var(--vp-button-alt-border);
    color: var(--vp-button-alt-text);
    background-color: var(--vp-button-alt-bg);
    border-radius: 20px;
    padding: 5px 10px;
    line-height: 18px;
    font-size: 14px;
    display: inline-block;
    border: 1px solid transparent;
    text-align: center;
    font-weight: 600;
    white-space: nowrap;
    transition: color 0.25s, border-color 0.25s, background-color 0.25s;
    margin-right: 0.5rem;
}

.links a {
  margin-right: 0.5rem;
}
</style>

# PGlite Extensions

PGlite supports both Postgres extensions, and has a plugin API to enable extensions to extend the public API of the PGlite interface.

Below is a list of available extensions.

<div class="tags">
  <button
    v-for="tag in tags"
    :key="tag.name"
    @click="
      selectedTag == tag.name ?
        selectedTag = null :
        selectedTag = tag.name
    "
    class="btn-tag"
    :class="{ selected: tag.name === selectedTag }"
  >
    {{ tag.name }} <span class="count">{{ tag.count }}</span>
  </button>
</div>

<div class="extension" v-for="ext in filteredExtensions">

<h2
  :id="slugify(ext.name)"
  tabindex="-1"
>
  <a :href="mainLink(ext)">{{ ext.name }}</a>
  <a 
    class="header-anchor"
    :href="`#${slugify(ext.name)}`"
    :aria-label="`Permalink to ${ext.name}`"
  >​</a>
</h2>

<div class="description" v-html="ext.descriptionHtml"></div>

<div class="links">
  <a 
    v-if="ext.repo?.startsWith('https://github.com/')" 
    :href="ext.repo"
    target="_blank"
  >Github</a>
  <a v-else-if="ext.repo" :href="ext.repo" target="_blank">Repo</a>
  <a v-if="ext.docs" :href="ext.docs" target="_blank">Documentation</a>
  <a v-if="ext.homepage" :href="ext.homepage" target="_blank">Homepage</a>
</div>
<div class="tags">
  <span v-for="tag in ext.tags" :key="tag" class="tag">{{ tag }}</span>
</div>

</div>
