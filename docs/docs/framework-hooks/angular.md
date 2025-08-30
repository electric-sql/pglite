---
outline: [2, 3]
---

# Angular

PGlite can be integrated into Angular as follows.

1. Create an app (skip if exists)

```sh
npm install -g @angular/cli@latest
NG_PROJECT_NAME=${NG_PROJECT_NAME:-"ng-pglite-demo"}
ng new --ai-config=none --inline-style --inline-template --routing \
  --ssr=false --style=scss --zoneless $NG_PROJECT_NAME
cd $NG_PROJECT_NAME
```

2. Install `@electric-sql/pglite` package

```sh
npm install @electric-sql/pglite
```

3. Update `angular.json` (with `jq` like below) or set the values manually

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

Visit http://localhost:4200 and notice the PostgreSQL version is rendered.
