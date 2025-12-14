# Bundler Support

Some bundlers require additional configuration to work with PGlite.

:::tip

If you come across any issues with PGlite and a specific bundler, please [open an issue](https://github.com/electric-sql/pglite/issues/new), we'd also love any contributions to this bundler documentation if you're able to help out.

:::

## Vite

When using [Vite](https://vitejs.dev/), make sure to exclude `pglite` from dependency optimization using the `optimizeDeps` option inside `vite.config.js`:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
```

### Additional configuration for the Multi-tab Worker

When using the Multi-tab Worker, you might encounter errors during a production build related to workers being bundle in `iife` format, to resolve this modify the `worker.format` option in `vite.config.js` to `'es'` (the default is `'iife'`)

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
})
```

When importing the worker in your script, you can use the recommended [?worker](https://vitejs.dev/guide/features#static-assets) import method from Vite:

```ts
import PGWorker from './worker.js?worker'

export const pglite = new PGliteWorker(
  new PGWorker({
    type: 'module',
      name: 'pglite-worker',
    }),
    {
      // ...your options here
    }
  },
)
```

## Next.js

When using [Next.js](https://nextjs.org/), make sure to add `@electric-sql/pglite` to the `transpilePackages` array in `next.config.js`:

```js
const nextConfig = {
  swcMinify: false,
  transpilePackages: [
    '@electric-sql/pglite-react', // Optional
    '@electric-sql/pglite',
  ],
}

export default nextConfig
```

## Angular

Create an app (skip if exists)

```sh
npm install -g @angular/cli@latest
NG_PROJECT_NAME=${NG_PROJECT_NAME:-"ng-pglite-demo"}
ng new --ai-config=none --inline-style --inline-template --routing \
  --ssr=false --style=scss --zoneless $NG_PROJECT_NAME
cd $NG_PROJECT_NAME
```

1. Install `@electric-sql/pglite` package

```sh
npm install @electric-sql/pglite
```

2. Update `angular.json` by adding the lines marked with `+`. If you've `jq` installed, run from terminal

```sh
cp angular.json angular.json.bak

jq --arg project_name "$NG_PROJECT_NAME" \
  '(.projects[$project_name].architect.build.configurations.development.externalDependencies += ["util"]) |
   (.projects[$project_name].architect.build.configurations.production.externalDependencies += ["util"]) |
   (.projects[$project_name].architect.build.options.allowedCommonJsDependencies += ["@electric-sql/pglite"]) |
   (.projects[$project_name].architect.build.options.assets += [{"glob": "**/*", "input": "node_modules/@electric-sql/pglite/dist", "output": "/"}]) |
   (.projects[$project_name].architect.serve.options.prebundle) = false' \
  angular.json > tmp.json && mv tmp.json angular.json
```

Or edit manually

```json
{
  "projects": {
    "ng-pglite-demo": {
      "architect": {
        "build": {
          "options": {
            "assets": [
+              {
+                "glob": "**/*",
+                "input": "node_modules/@electric-sql/pglite/dist",
+                "output": "/"
+              }
             ],
+            "allowedCommonJsDependencies": [
+              "@electric-sql/pglite"
+            ]
           },
          "configurations": {
            "production": {
+              "externalDependencies": [
+                "util"
+              ]
             },
             "development": {
+              "externalDependencies": [
+                "util"
+              ]
             }
           },
        },
        "serve": {
+          "options": {
+            "prebundle": false
+          }
         }
```

3. Use PGlite in a service / component eg `src/app/app.ts` like below

```ts
import { CommonModule } from '@angular/common'
import { Component, signal } from '@angular/core'
import { PGlite } from '@electric-sql/pglite'

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  template: `
    <h2>PostgreSQL version</h2>
    @if (version()) {
      <span>{{ version() }}</span>
    } @else {
      <span>Loading...</span>
    }
  `,
  styles: ``,
})
export class App {
  db = new PGlite()
  version = signal<string | null>(null)

  async ngOnInit() {
    try {
      const result = await this.db.query<{ version: string }>(
        'SELECT version()',
      )
      this.version.set(result.rows[0].version)
    } catch (err) {
      console.error('Error initializing database:', err)
    }
  }
}
```

4. Verify

```sh
ng serve
```

Visit `localhost:4200` and notice the PostgreSQL version is rendered.
