---
outline: [2, 3]
---

<script setup>
import { defineClientComponent } from 'vitepress'

const Repl = defineClientComponent(() => {
  return import('../components/Repl.vue')
})
</script>

# PGlite REPL Component

A REPL, or terminal, for use in the browser with PGlite, allowing you to have an interactive session with your WASM Postgres in the page.

This is the REPL with a full PGlite Postgres embeded in the page:

<ClientOnly>
  <Repl />
</ClientOnly>

## Features:

- Available as both a [React.js](#react-component) component and a [Web Component](#web-component)
- [CodeMirror](https://codemirror.net) for input editing
- Auto complete, including table and column names from the database
- Input history (up and down keys)
- `\d` PSQL commands (via [psql-describe](https://www.npmjs.com/package/psql-describe))

## React Component

```bash
npm install @electric-sql/pglite-repl
```

then to include in a page:

```tsx
import { PGlite } from "@electric-sql/pglite";
import { Repl } from "@electric-sql/pglite-repl";

function MyComponent() {
  const pg = new PGlite();

  return <>
    <Repl pg={pg} />
  </>
}
```

The props for the `<Repl>` component are described by this interface:

```ts
// The theme to use, auto is auto switching based on the system
type ReplTheme = "light" | "dark" | "auto";

interface ReplProps {
  pg: PGlite;  // PGlite db instance
  border?: boolean;  // Outer border on the component, defaults to false
  lightTheme?: Extension;
  darkTheme?: Extension;
  theme?: ReplTheme;  // Defaults to "auto"
}
```

The `lightTheme` and `darkTheme` should be instances of a [React CodeMirror](https://uiwjs.github.io/react-codemirror/) theme.

## Web Component

Although the PGlite REPL is built with React, its also available as a web component for easy inclusion in any page or other framework.

```html
<script src="https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist-webcomponent/Repl.js" type="module"></script>

<!-- Include the Repl web component in your page -->
<pglite-repl id="repl"></pglite-repl>

<script type="module">
  import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js";

  // Create a PGlite instance
  const pg = new PGlite();

  // Retrieve the Repl element
  const repl = document.getElementById('repl');

  // REPL to your PGlite instance
  repl.pg = pg;
</script>
```

### With Vue.js

The REPL Web Component can be used with Vue.js, and in fact thats how its embeded above.

```vue
<script setup>
import { PGlite } from "@electric-sql/pglite";
import "@electric-sql/pglite-repl/webcomponent";

const pg = new PGlite();
</script>
<template>
  <pglite-repl :pg="pg" />
</template>
```

You will also need to configure Vue to ignore the `pglite-` prefix:

```ts
app.config.compilerOptions.isCustomElement = (tag) => {
  return tag.startsWith('pglite-')
}
```

See the [Vue docs for more details](https://vuejs.org/api/application.html#app-config-compileroptions-iscustomelement).