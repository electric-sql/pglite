# PGlite REPL React Component

A REPL, or terminal, for use in the browser with PGlite, allowing you to have an interactive session with your WASM Postgres in the page.

<img width="918" src="https://github.com/electric-sql/pglite/assets/31130/f7c9c2dd-4de8-4033-9905-9637ae998034">

## Features:

- Available as both a React.js component and a Web Components
- [CodeMirror](https://codemirror.net) for input editing
- Auto complete, including table and column names from the database
- Input history (up and down keys)
- `\d` PSQL commands (via [psql-describe](https://www.npmjs.com/package/psql-describe))

## How to use with React

```
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

## How to use as a Web Component

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

## Development

Checkout this repo and from package dir:

```sh
# Install deps
pnpm install

# Run dev server
pnpm dev
# then open a browser to the url shown

# Build the lib
pnpm build
```
